/**
 * @file storage-test.factory.ts
 * @description SeaweedFS integration fixture with run-owned cleanup.
 */

import {
    HeadObjectCommand,
    ListMultipartUploadsCommand,
    paginateListObjectsV2,
    type ListMultipartUploadsCommandInput,
    type S3Client,
} from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { EnvironmentVariables } from 'src/core/config';
import { StorageModule, TOKEN_STORAGE_PORT, type IStoragePort } from 'src/core/storage';
import { TOKEN_S3_CLIENT } from 'src/core/storage/storage-client.token';
import { ResourceNotFoundException } from 'src/shared/exception';
import { vi } from 'vitest';

/**
 * Storage configuration required by integration tests.
 */
type StorageTestConfig = Pick<
    EnvironmentVariables,
    'STORAGE_BUCKET' | 'STORAGE_REGION' | 'STORAGE_ENDPOINT' | 'STORAGE_CONNECT_TIMEOUT' | 'STORAGE_REQUEST_TIMEOUT'
>;

/**
 * Resolves the production port without an application listener, database, or Redis.
 *
 * @returns A fixture that must be closed even after failed assertions.
 */
export async function createStorageTestFixture(): Promise<StorageTestFixture> {
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'local-development');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'local-development-secret');
    vi.stubEnv('AWS_SESSION_TOKEN', undefined);
    const config: StorageTestConfig = {
        STORAGE_BUCKET: 'storage-test',
        STORAGE_REGION: 'us-east-1',
        STORAGE_ENDPOINT: 'http://127.0.0.1:8333',
        STORAGE_CONNECT_TIMEOUT: 2,
        STORAGE_REQUEST_TIMEOUT: 5,
    };

    try {
        const module = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({
                    isGlobal: true,
                    ignoreEnvFile: true,
                    skipProcessEnv: true,
                    load: [() => config],
                }),
                StorageModule,
            ],
        }).compile();
        return new StorageTestFixture(module, config.STORAGE_BUCKET);
    } catch (error) {
        vi.unstubAllEnvs();
        throw error;
    }
}

/**
 * Owns one unique prefix; provider access is limited to observation, fault injection, and cleanup.
 */
export class StorageTestFixture {
    /**
     * Production contract exercised by every scenario.
     */
    readonly storage: IStoragePort;
    /**
     * Production client, exposed only for transport fault injection.
     */
    readonly client: S3Client;
    /**
     * Trailing slash prevents cleanup from matching another run's prefix.
     */
    private readonly prefix = `contract/${randomUUID()}/`;

    /**
     * Retains resources and resolves the production bindings.
     *
     * @param module Storage-only Nest module owned by this fixture.
     * @param bucket Bucket containing only isolated test data.
     */
    constructor(
        private readonly module: TestingModule,
        private readonly bucket: string,
    ) {
        this.storage = module.get<IStoragePort>(TOKEN_STORAGE_PORT);
        this.client = module.get<S3Client>(TOKEN_S3_CLIENT);
    }

    /**
     * Allocates an object key inside this fixture's cleanup boundary.
     *
     * @returns A unique run-owned key.
     */
    key(): string {
        return `${this.prefix}${randomUUID()}`;
    }

    /**
     * Observes cache metadata intentionally absent from the application port's read model.
     *
     * @param key Run-owned object to inspect after a port operation.
     * @returns The provider's stored Cache-Control value.
     */
    async readCacheControl(key: string): Promise<string | undefined> {
        return (await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))).CacheControl;
    }

    /**
     * Cleans the whole run prefix, including sessions whose creation response was lost.
     * Attempts all resources and reports failures instead of abandoning later cleanup.
     */
    async cleanup() {
        const failures: unknown[] = [];
        try {
            const input: ListMultipartUploadsCommandInput = { Bucket: this.bucket, Prefix: this.prefix };
            while (true) {
                const page = await this.client.send(new ListMultipartUploadsCommand(input));
                for (const upload of page.Uploads ?? []) {
                    if (!upload.Key?.startsWith(this.prefix) || !upload.UploadId) {
                        throw new Error('Storage cleanup received an invalid multipart identity.');
                    }
                    try {
                        await this.storage.abortMultipart({ key: upload.Key, uploadId: upload.UploadId });
                    } catch (error) {
                        if (!(error instanceof ResourceNotFoundException)) {
                            failures.push(error);
                        }
                    }
                }
                if (!page.IsTruncated) {
                    break;
                }
                if (
                    !page.NextKeyMarker ||
                    !page.NextUploadIdMarker ||
                    (page.NextKeyMarker === input.KeyMarker && page.NextUploadIdMarker === input.UploadIdMarker)
                ) {
                    throw new Error('Storage cleanup could not advance multipart pagination.');
                }
                input.KeyMarker = page.NextKeyMarker;
                input.UploadIdMarker = page.NextUploadIdMarker;
            }
        } catch (error) {
            failures.push(error);
        }

        try {
            for await (const page of paginateListObjectsV2(
                { client: this.client },
                { Bucket: this.bucket, Prefix: this.prefix },
            )) {
                for (const object of page.Contents ?? []) {
                    if (!object.Key?.startsWith(this.prefix)) {
                        throw new Error('Storage cleanup received an invalid object key.');
                    }
                    try {
                        await this.storage.deleteObject(object.Key);
                    } catch (error) {
                        failures.push(error);
                    }
                }
            }
        } catch (error) {
            failures.push(error);
        }

        if (failures.length) {
            throw new AggregateError(failures, 'Storage run cleanup failed.');
        }
    }

    /**
     * Retries cleanup before releasing the client, even when an earlier cleanup failed.
     */
    async close() {
        try {
            await this.cleanup();
        } finally {
            try {
                await this.module.close();
            } finally {
                vi.unstubAllEnvs();
            }
        }
    }
}
