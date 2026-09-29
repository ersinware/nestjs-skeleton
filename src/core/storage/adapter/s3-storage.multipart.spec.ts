/**
 * @file s3-storage.multipart.spec.ts
 * @description Multipart planning, completion failures, and cleanup through the S3 adapter.
 */

import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { S3StorageAdapter } from 'src/core/storage/adapter/s3-storage.adapter';
import type { StorageCompleteMultipartRequest, StorageUploadRequest } from 'src/core/storage/port/storage.port';
import {
    DependencyUnavailableException,
    InvalidInputException,
    ResourceConflictException,
    ResourceNotFoundException,
    SystemException,
} from 'src/shared/exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('S3StorageAdapter multipart', () => {
    let client: S3Client;
    let adapter: S3StorageAdapter;
    const config = new ConfigService({ STORAGE_BUCKET: 'storage-test' });
    const request: StorageUploadRequest = {
        key: 'contract/multipart',
        sizeBytes: 11 * 1024 * 1024,
        contentType: 'application/octet-stream',
        cache: { visibility: 'no-store' },
        deadline: new Date('2026-09-29T10:05:00Z'),
    };
    const complete: StorageCompleteMultipartRequest = {
        key: request.key,
        uploadId: 'session',
        partCount: 3,
        parts: [1, 2, 3].map((partNumber) => ({ partNumber, etag: `"opaque-${partNumber}"` })),
    };

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-29T10:00:00Z'));
        client = new S3Client({
            region: 'us-east-1',
            endpoint: 'http://127.0.0.1:8333',
            forcePathStyle: true,
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
            requestChecksumCalculation: 'WHEN_REQUIRED',
            maxAttempts: 1,
        });
        adapter = new S3StorageAdapter(client, config);
    });

    afterEach(() => {
        client.destroy();
        vi.useRealTimers();
    });

    it('signs every numbered part and its exact size, including the short final part', async () => {
        const send = vi.spyOn(client, 'send').mockImplementation(vi.fn().mockResolvedValue({ UploadId: 'session' }));
        const plan = await adapter.initiateUpload(request);
        if (plan.mode !== 'multipart') {
            throw new Error('Expected multipart upload.');
        }
        expect(plan.partCount).toBe(3);
        expect(plan.partSizeBytes).toBe(5 * 1024 * 1024);
        expect(plan.parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);
        for (const part of plan.parts) {
            const url = new URL(part.request.url);
            expect(url.searchParams.get('uploadId')).toBe('session');
            expect(url.searchParams.get('partNumber')).toBe(String(part.partNumber));
            expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;host');
            expect([...url.searchParams.keys()].some((key) => /checksum/i.test(key))).toBe(false);
            expect(part.request.expiresAt).toEqual(request.deadline);
            expect(part.request.headers).toEqual({});
        }
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.any(CreateMultipartUploadCommand));
        expect(send.mock.calls[0]![0].input).toMatchObject({
            ContentType: request.contentType,
            CacheControl: 'no-store',
        });
    });

    it('does not try to abort when create fails without an upload ID', async () => {
        const error = Object.assign(new Error('create response lost'), { code: 'ECONNRESET' });
        const send = vi.spyOn(client, 'send').mockRejectedValue(error);
        await expect(adapter.initiateUpload(request)).rejects.toMatchObject({ cause: error });
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.any(CreateMultipartUploadCommand));
    });

    it('reports an incomplete create response as a system failure', async () => {
        vi.spyOn(client, 'send').mockImplementation(vi.fn().mockResolvedValue({}));
        await expect(adapter.initiateUpload(request)).rejects.toMatchObject({
            context: { stage: 'create-multipart-upload' },
        });
    });

    it.each([false, true])('aborts on signing failure and preserves it when cleanup fails (%s)', async (abortFails) => {
        const signingError = Object.assign(new Error('credentials unavailable'), { name: 'CredentialsProviderError' });
        client.config.credentials = () => Promise.reject(signingError);
        const send = vi.spyOn(client, 'send').mockImplementation(
            vi
                .fn()
                .mockResolvedValueOnce({ UploadId: 'session' })
                .mockImplementationOnce(() =>
                    abortFails ? Promise.reject(new Error('abort unavailable')) : Promise.resolve({}),
                ),
        );
        await expect(adapter.initiateUpload(request)).rejects.toMatchObject({
            cause: signingError,
            context: { stage: 'sign-multipart-parts' },
        });
        expect(send).toHaveBeenLastCalledWith(expect.any(AbortMultipartUploadCommand));
        expect(send.mock.calls[1]![0].input).toEqual({ Bucket: 'storage-test', Key: request.key, UploadId: 'session' });
    });

    it.each([
        { ...complete, parts: complete.parts.slice(0, 2) },
        { ...complete, parts: [complete.parts[0]!, complete.parts[0]!, complete.parts[2]!] },
        { ...complete, parts: [...complete.parts].reverse() },
        { ...complete, parts: [{ partNumber: 0, etag: 'tag' }, ...complete.parts.slice(1)] },
        { ...complete, parts: [...complete.parts.slice(0, 2), { partNumber: 4, etag: 'tag' }] },
        { ...complete, parts: [...complete.parts.slice(0, 2), { partNumber: 3, etag: '' }] },
        { ...complete, partCount: 0, parts: [] },
        { ...complete, partCount: 1.5 },
        { ...complete, partCount: 10_001 },
    ])('rejects an invalid manifest before completing', async (invalid) => {
        const send = vi.spyOn(client, 'send');
        await expect(adapter.completeMultipart(invalid)).rejects.toBeInstanceOf(InvalidInputException);
        expect(send).not.toHaveBeenCalled();
    });

    it('completes a 10,000-part manifest without interpreting opaque ETags', async () => {
        const send = vi.spyOn(client, 'send').mockImplementation(vi.fn().mockResolvedValue({}));
        const parts = Array.from({ length: 10_000 }, (_, index) => ({
            partNumber: index + 1,
            etag: `"opaque-${index}"`,
        }));
        await expect(
            adapter.completeMultipart({ ...complete, partCount: parts.length, parts }),
        ).resolves.toBeUndefined();
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.any(CompleteMultipartUploadCommand));
        expect(send.mock.calls[0]![0].input).toEqual({
            Bucket: 'storage-test',
            Key: complete.key,
            UploadId: complete.uploadId,
            IfNoneMatch: '*',
            MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) },
        });
    });

    it.each([
        [409, 'ConditionalRequestConflict', ResourceConflictException],
        [412, 'PreconditionFailed', ResourceConflictException],
        [404, 'NoSuchUpload', ResourceNotFoundException],
        [400, 'InvalidPart', InvalidInputException],
        [400, 'InvalidPartOrder', InvalidInputException],
        [400, 'EntityTooSmall', InvalidInputException],
        [503, 'SlowDown', DependencyUnavailableException],
        [403, 'AccessDenied', SystemException],
    ] as const)('preserves the completion failure cause for %i %s', async (status, name, type) => {
        const error = { name, $metadata: { httpStatusCode: status } };
        const send = vi.spyOn(client, 'send').mockRejectedValue(error);
        await expect(adapter.completeMultipart(complete)).rejects.toBeInstanceOf(type);
        await expect(adapter.completeMultipart(complete)).rejects.toMatchObject({ cause: error });
        expect(send.mock.calls.every(([command]) => command instanceof CompleteMultipartUploadCommand)).toBe(true);
    });

    it('leaves an unknown completion outcome to the caller without aborting or restarting', async () => {
        const error = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
        const send = vi.spyOn(client, 'send').mockRejectedValue(error);
        await expect(adapter.completeMultipart(complete)).rejects.toBeInstanceOf(DependencyUnavailableException);
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.any(CompleteMultipartUploadCommand));
    });

    it('lets the real SDK reject an error embedded in HTTP 200', async () => {
        const handle = vi.fn().mockResolvedValue({
            response: {
                statusCode: 200,
                headers: { 'content-type': 'application/xml' },
                body: Readable.from(['<Error><Code>InvalidPart</Code><Message>Part missing</Message></Error>']),
            },
        });
        client.config.requestHandler = { handle };
        await expect(adapter.completeMultipart(complete)).rejects.toMatchObject({ cause: { name: 'InvalidPart' } });
        expect(handle).toHaveBeenCalledOnce();
    });

    it('surfaces abort-after-complete as a missing session without deleting the object', async () => {
        const send = vi
            .spyOn(client, 'send')
            .mockRejectedValue({ name: 'NoSuchUpload', $metadata: { httpStatusCode: 404 } });
        await expect(adapter.abortMultipart({ key: complete.key, uploadId: complete.uploadId })).rejects.toBeInstanceOf(
            ResourceNotFoundException,
        );
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.any(AbortMultipartUploadCommand));
    });
});
