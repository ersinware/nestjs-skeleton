/**
 * @file s3-storage.adapter.spec.ts
 * @description S3 adapter contract checks without external service calls.
 */

import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { S3StorageAdapter } from 'src/core/storage/adapter/s3-storage.adapter';
import type { StorageUploadRequest } from 'src/core/storage/port/storage.port';
import {
    DependencyUnavailableException,
    InvalidInputException,
    ResourceNotFoundException,
    SystemException,
} from 'src/shared/exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Minimal validated configuration consumed by the adapter.
 */
const config = new ConfigService({ STORAGE_BUCKET: 'storage-test' });

describe('S3StorageAdapter', () => {
    let client: S3Client;
    let adapter: S3StorageAdapter;
    let request: StorageUploadRequest;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-29T10:00:00.250Z'));
        client = new S3Client({
            region: 'us-east-1',
            endpoint: 'http://127.0.0.1:8333',
            forcePathStyle: true,
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
            requestChecksumCalculation: 'WHEN_REQUIRED',
        });
        adapter = new S3StorageAdapter(client, config);
        request = {
            key: 'pending/avatar/user/id',
            sizeBytes: 3,
            contentType: 'image/png',
            cache: { visibility: 'no-store' },
            deadline: new Date(Date.now() + 300_000),
        };
    });

    afterEach(() => {
        client.destroy();
        vi.useRealTimers();
    });

    it('signs every required PUT header without requiring a browser content length or checksum', async () => {
        const send = vi.spyOn(client, 'send');
        const plan = await adapter.initiateUpload(request);

        expect(plan.mode).toBe('single');
        if (plan.mode !== 'single') {
            throw new Error('Expected a single upload.');
        }

        const url = new URL(plan.request.url);
        expect(url.host).toBe('127.0.0.1:8333');
        expect(url.pathname).toBe('/storage-test/pending/avatar/user/id');
        expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual([
            'cache-control',
            'content-type',
            'host',
            'if-none-match',
        ]);
        expect([...url.searchParams.keys()].some((key) => /checksum/i.test(key))).toBe(false);
        expect(plan.request.headers).toEqual({
            'content-type': 'image/png',
            'if-none-match': '*',
            'cache-control': 'no-store',
        });
        expect(send).not.toHaveBeenCalled();
    });

    it.each([
        [30_750, '31', '2026-09-29T10:00:31.000Z'],
        [1_800_000, '300', '2026-09-29T10:05:00.000Z'],
    ])('caps expiry at the deadline and five minutes (%i ms)', async (duration, seconds, expiry) => {
        const plan = await adapter.initiateUpload({ ...request, deadline: new Date(Date.now() + duration) });
        if (plan.mode !== 'single') {
            throw new Error('Expected a single upload.');
        }

        expect(new URL(plan.request.url).searchParams.get('X-Amz-Expires')).toBe(seconds);
        expect(plan.request.expiresAt).toEqual(new Date(expiry));
    });

    it('keeps the reported expiry aligned with the signature when credential resolution is delayed', async () => {
        client.config.credentials = () => {
            vi.setSystemTime(new Date('2026-09-29T10:00:05Z'));
            return Promise.resolve({ accessKeyId: 'test', secretAccessKey: 'test' });
        };
        const plan = await adapter.initiateUpload(request);
        if (plan.mode !== 'single') {
            throw new Error('Expected a single upload.');
        }

        expect(new URL(plan.request.url).searchParams.get('X-Amz-Date')).toBe('20260929T100000Z');
        expect(plan.request.expiresAt).toEqual(new Date('2026-09-29T10:05:00Z'));
        expect(plan.request.expiresAt.getTime()).toBeLessThanOrEqual(request.deadline.getTime());
    });

    it.each([new Date('invalid'), new Date('2026-09-29T10:00:00Z'), new Date('2026-09-29T10:00:00.500Z')])(
        'rejects unusable deadlines without contacting storage (%s)',
        async (deadline) => {
            const send = vi.spyOn(client, 'send');
            await expect(adapter.initiateUpload({ ...request, deadline })).rejects.toBeInstanceOf(
                InvalidInputException,
            );
            expect(send).not.toHaveBeenCalled();
        },
    );

    it('reads the actual object descriptor without returning unrelated provider metadata', async () => {
        const send = vi.fn().mockResolvedValue({
            ContentLength: 4,
            ETag: '"opaque-etag"',
            ContentType: 'image/png',
            CacheControl: 'no-store',
            Metadata: { ignored: 'value' },
        });
        adapter = new S3StorageAdapter({ send } as never, config);

        await expect(adapter.headObject(request.key)).resolves.toEqual({
            sizeBytes: 4,
            etag: '"opaque-etag"',
            contentType: 'image/png',
        });
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.any(HeadObjectCommand));
        expect((send.mock.calls[0]?.[0] as HeadObjectCommand).input).toEqual({
            Bucket: 'storage-test',
            Key: request.key,
        });
    });

    it('preserves zero-byte objects and omits an absent content type', async () => {
        const send = vi.fn().mockResolvedValue({ ContentLength: 0, ETag: '"etag"' });
        adapter = new S3StorageAdapter({ send } as never, config);
        await expect(adapter.headObject(request.key)).resolves.toEqual({ sizeBytes: 0, etag: '"etag"' });
    });

    it.each([{ ContentLength: 3 }, { ETag: '"etag"' }])('rejects incomplete HEAD metadata (%j)', async (head) => {
        const send = vi.fn().mockResolvedValue(head);
        adapter = new S3StorageAdapter({ send } as never, config);
        await expect(adapter.headObject(request.key)).rejects.toBeInstanceOf(SystemException);
    });

    it.each([
        [{ name: 'NotFound', $metadata: { httpStatusCode: 404 } }, ResourceNotFoundException],
        [{ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }, SystemException],
        [{ code: 'ECONNREFUSED' }, DependencyUnavailableException],
    ])('classifies HeadObject failure %j', async (error, expected) => {
        vi.spyOn(client, 'send').mockRejectedValue(error);
        await expect(adapter.headObject(request.key)).rejects.toBeInstanceOf(expected);
    });

    it('preserves an unexpected HEAD failure', async () => {
        const error = new Error('Unexpected SDK failure');
        vi.spyOn(client, 'send').mockRejectedValue(error);
        await expect(adapter.headObject(request.key)).rejects.toBe(error);
    });
});
