/**
 * @file s3-storage.adapter.ts
 * @description S3-backed storage operations.
 */

import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CopyObjectCommand,
    CreateMultipartUploadCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
    UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ENV } from 'src/core/config';
import {
    type IStoragePort,
    type StorageAbortMultipartRequest,
    type StorageCachePolicy,
    type StorageCompleteMultipartRequest,
    type StorageCopyRequest,
    type StorageObject,
    type StorageUploadPlan,
    type StorageUploadRequest,
} from 'src/core/storage/port/storage.port';
import { TOKEN_S3_CLIENT } from 'src/core/storage/storage-client.token';
import { translateStorageError } from 'src/core/storage/storage-error.util';
import { planStorageUpload } from 'src/core/storage/storage-upload-policy';
import { InvalidInputException, SystemException } from 'src/shared/exception';

/**
 * Maximum lifetime of a presigned upload URL, in seconds.
 */
const MAX_PRESIGNED_URL_TTL_SECONDS = 5 * 60;

/**
 * S3 maximum source size for one CopyObject request (5 GB).
 */
const MAX_SINGLE_COPY_BYTES = 5_000_000_000;

/**
 * Performs workflow-owned object operations through S3.
 */
@Injectable()
export class S3StorageAdapter implements IStoragePort {
    /**
     * Bucket shared by all operations in this adapter.
     */
    private readonly bucket: string;

    /**
     * Uses one endpoint for server operations and browser-facing signatures.
     *
     * @param client S3 operations and signing client.
     * @param config Validated storage configuration.
     */
    constructor(
        @Inject(TOKEN_S3_CLIENT) private readonly client: S3Client,
        config: ConfigService,
    ) {
        this.bucket = config.getOrThrow<string>(ENV.STORAGE_BUCKET);
    }

    /**
     * Signs one conditional PUT or every part of a multipart upload.
     *
     * @param request Workflow-selected object details and deadline.
     * @returns The upload mode and signed requests.
     */
    async initiateUpload(request: StorageUploadRequest): Promise<StorageUploadPlan> {
        // SigV4 timestamps have whole-second precision; expiry must use the same clock.
        const plan = planStorageUpload(request.sizeBytes),
            now = new Date(Math.floor(Date.now() / 1000) * 1000),
            expiresIn = this.calculatePresignedUrlTtlSeconds(request.deadline, now),
            cacheControl = buildCacheControlHeader(request.cache);

        if (plan.mode === 'single') {
            const headers = {
                'content-type': request.contentType,
                'if-none-match': '*',
                'cache-control': cacheControl,
            };

            try {
                return {
                    mode: 'single',
                    request: {
                        url: await getSignedUrl(
                            this.client,
                            new PutObjectCommand({
                                Bucket: this.bucket,
                                Key: request.key,
                                ContentType: headers['content-type'],
                                IfNoneMatch: headers['if-none-match'],
                                CacheControl: headers['cache-control'],
                            }),
                            { expiresIn, signingDate: now, signableHeaders: new Set(Object.keys(headers)) },
                        ),
                        headers,
                        expiresAt: new Date(now.getTime() + expiresIn * 1000),
                    },
                };
            } catch (error) {
                throw translateStorageError(error, {
                    class: this.constructor.name,
                    method: this.initiateUpload.name,
                    stage: 'sign-single-upload',
                });
            }
        }

        let uploadId: string;

        try {
            const command = await this.client.send(
                new CreateMultipartUploadCommand({
                    Bucket: this.bucket,
                    Key: request.key,
                    ContentType: request.contentType,
                    CacheControl: cacheControl,
                }),
            );

            if (!command.UploadId) {
                throw new SystemException('S3 did not return a multipart upload ID.', {
                    context: {
                        class: this.constructor.name,
                        method: this.initiateUpload.name,
                        stage: 'create-multipart-upload',
                    },
                });
            }

            uploadId = command.UploadId;
        } catch (error) {
            throw translateStorageError(error, {
                class: this.constructor.name,
                method: this.initiateUpload.name,
                stage: 'create-multipart-upload',
            });
        }

        try {
            return {
                mode: 'multipart',
                uploadId,
                partSizeBytes: plan.partSizeBytes,
                partCount: plan.partCount,
                parts: await Promise.all(
                    Array.from({ length: plan.partCount }, async (_, index) => {
                        const partNumber = index + 1;

                        return {
                            partNumber,
                            request: {
                                url: await getSignedUrl(
                                    this.client,
                                    new UploadPartCommand({
                                        Bucket: this.bucket,
                                        Key: request.key,
                                        UploadId: uploadId,
                                        PartNumber: partNumber,
                                    }),
                                    { expiresIn, signingDate: now },
                                ),
                                headers: {},
                                expiresAt: new Date(now.getTime() + expiresIn * 1000),
                            },
                        };
                    }),
                ),
            };
        } catch (error) {
            try {
                await this.client.send(
                    new AbortMultipartUploadCommand({
                        Bucket: this.bucket,
                        Key: request.key,
                        UploadId: uploadId,
                    }),
                );
            } catch {
                // Preserve the signing failure; multipart cleanup is best effort.
            }

            throw translateStorageError(error, {
                class: this.constructor.name,
                method: this.initiateUpload.name,
                stage: 'sign-multipart-parts',
            });
        }
    }

    /**
     * Reads object metadata and surfaces a missing object as an exception.
     *
     * @param key Workflow-owned object key.
     * @returns Object metadata.
     */
    async headObject(key: string): Promise<StorageObject> {
        try {
            const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));

            if (head.ContentLength === undefined || head.ETag === undefined) {
                throw new SystemException('S3 returned incomplete object metadata.', {
                    context: {
                        class: this.constructor.name,
                        method: this.headObject.name,
                    },
                });
            }

            return {
                sizeBytes: head.ContentLength,
                etag: head.ETag,
                ...(head.ContentType !== undefined && { contentType: head.ContentType }),
            };
        } catch (error) {
            throw translateStorageError(error, {
                class: this.constructor.name,
                method: this.headObject.name,
            });
        }
    }

    /**
     * Completes a multipart upload only with an ordered, complete manifest.
     *
     * @param request Authorized session and client-observed completed parts.
     */
    async completeMultipart(request: StorageCompleteMultipartRequest) {
        if (
            request.parts.length !== request.partCount ||
            request.parts.some((part, index) => part.partNumber !== index + 1 || !part.etag)
        ) {
            throw new InvalidInputException('Multipart manifest does not match the upload plan.');
        }
        try {
            await this.client.send(
                new CompleteMultipartUploadCommand({
                    Bucket: this.bucket,
                    Key: request.key,
                    UploadId: request.uploadId,
                    MultipartUpload: {
                        Parts: request.parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
                    },
                    IfNoneMatch: '*',
                }),
            );
        } catch (error) {
            throw translateStorageError(error, {
                class: this.constructor.name,
                method: this.completeMultipart.name,
            });
        }
    }

    /**
     * Aborts the authorized multipart session.
     *
     * @param request Authorized session identity.
     */
    async abortMultipart(request: StorageAbortMultipartRequest) {
        try {
            await this.client.send(
                new AbortMultipartUploadCommand({
                    Bucket: this.bucket,
                    Key: request.key,
                    UploadId: request.uploadId,
                }),
            );
        } catch (error) {
            throw translateStorageError(error, {
                class: this.constructor.name,
                method: this.abortMultipart.name,
            });
        }
    }

    /**
     * Copies an object with the caller's content type and cache policy.
     *
     * @param request Source, destination, content type, and cache policy.
     */
    async copyObject(request: StorageCopyRequest) {
        const object = await this.headObject(request.sourceKey);

        if (object.sizeBytes > MAX_SINGLE_COPY_BYTES) {
            throw new InvalidInputException('Source exceeds the S3 single-copy limit.');
        }

        try {
            await this.client.send(
                new CopyObjectCommand({
                    Bucket: this.bucket,
                    Key: request.destinationKey,
                    CopySource: `${this.bucket}/${request.sourceKey.split('/').map(encodeURIComponent).join('/')}`,
                    CopySourceIfMatch: request.sourceEtag,
                    ContentType: request.contentType,
                    MetadataDirective: 'REPLACE',
                    CacheControl: buildCacheControlHeader(request.cache),
                }),
            );
        } catch (error) {
            throw translateStorageError(error, {
                class: this.constructor.name,
                method: this.copyObject.name,
            });
        }
    }

    /**
     * Deletes the object at the workflow-owned key.
     *
     * @param key Workflow-owned object key.
     */
    async deleteObject(key: string) {
        try {
            await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
        } catch (error) {
            throw translateStorageError(error, {
                class: this.constructor.name,
                method: this.deleteObject.name,
            });
        }
    }

    /**
     * Caps a request's lifetime at the workflow deadline and configured maximum.
     *
     * @param deadline Workflow's absolute upload deadline.
     * @param signingDate Timestamp used in the signature.
     * @returns Remaining signing lifetime in whole seconds.
     */
    private calculatePresignedUrlTtlSeconds(deadline: Date, signingDate: Date): number {
        const remaining = Math.floor((deadline.getTime() - signingDate.getTime()) / 1000);

        if (!Number.isFinite(remaining) || remaining < 1) {
            throw new InvalidInputException('Upload deadline has expired.');
        }

        return Math.min(remaining, MAX_PRESIGNED_URL_TTL_SECONDS);
    }
}

/**
 * Converts caller-selected cache policy to an HTTP header value.
 *
 * @param cache Caller-selected cache policy.
 * @returns The Cache-Control header value.
 */
function buildCacheControlHeader(cache: StorageCachePolicy): string {
    const directives: string[] = [cache.visibility];

    if (cache.maxAgeSeconds !== undefined) {
        directives.push(`max-age=${cache.maxAgeSeconds}`);
    }

    if (cache.sharedMaxAgeSeconds !== undefined) {
        directives.push(`s-maxage=${cache.sharedMaxAgeSeconds}`);
    }

    if (cache.immutable) {
        directives.push('immutable');
    }

    return directives.join(', ');
}
