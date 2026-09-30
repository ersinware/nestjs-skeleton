/**
 * @file object-copy.e2e-spec.ts
 * @description Copy metadata and idempotent source cleanup through the production storage module.
 */

import { HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { TOKEN_STORAGE_PORT, type IStoragePort, type StorageObject } from 'src/core/storage';
import { TOKEN_S3_CLIENT } from 'src/core/storage/storage-client.token';
import { ResourceNotFoundException } from 'src/shared/exception';
import { createStorageTestModule } from 'test/shared/storage-test.factory';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

describe('Object copy and cleanup (SeaweedFS)', () => {
    let module: TestingModule;
    let storage: IStoragePort;
    let client: S3Client;
    const prefix = `contract/${randomUUID()}`;
    const keys = new Set<string>();
    const body = Buffer.from('object copy contract bytes');

    beforeAll(async () => {
        vi.stubEnv('AWS_ACCESS_KEY_ID', 'local-development');
        vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'local-development-secret');
        vi.stubEnv('AWS_SESSION_TOKEN', undefined);
        module = await createStorageTestModule({
            STORAGE_BUCKET: 'storage-test',
            STORAGE_REGION: 'us-east-1',
            STORAGE_ENDPOINT: 'http://127.0.0.1:8333',
            STORAGE_CONNECT_TIMEOUT: 2,
            STORAGE_REQUEST_TIMEOUT: 5,
        });
        storage = module.get<IStoragePort>(TOKEN_STORAGE_PORT);
        client = module.get<S3Client>(TOKEN_S3_CLIENT);
    });

    afterEach(async () => {
        for (const key of keys) {
            await storage.deleteObject(key);
            keys.delete(key);
        }
    });

    afterAll(async () => {
        try {
            await module?.close();
        } finally {
            vi.unstubAllEnvs();
        }
    });

    /**
     * Uploads one run-owned source object with pending-object cache metadata.
     *
     * @returns Source key and verified object descriptor.
     */
    async function uploadSource(): Promise<{ readonly key: string; readonly object: StorageObject }> {
        const key = `${prefix}/pending/${randomUUID()}`;
        keys.add(key);
        const plan = await storage.initiateUpload({
            key,
            sizeBytes: body.length,
            contentType: 'image/png',
            cache: { visibility: 'no-store' },
            deadline: new Date(Date.now() + 300_000),
        });
        if (plan.mode !== 'single') {
            throw new Error('Expected a single upload.');
        }
        const response = await fetch(plan.request.url, {
            method: 'PUT',
            headers: plan.request.headers,
            body,
        });
        await response.arrayBuffer();
        expect(response.status).toBe(200);

        return { key, object: await storage.headObject(key) };
    }

    it('replaces content/cache metadata at the destination without deleting the source', async () => {
        const source = await uploadSource();
        const destinationKey = `${prefix}/avatar/${randomUUID()}`;
        keys.add(destinationKey);

        await storage.copyObject({
            sourceKey: source.key,
            destinationKey,
            sourceEtag: source.object.etag,
            contentType: 'image/webp',
            cache: {
                visibility: 'public',
                maxAgeSeconds: 31_536_000,
                sharedMaxAgeSeconds: 31_536_000,
                immutable: true,
            },
        });

        await expect(storage.headObject(source.key)).resolves.toEqual(source.object);
        await expect(
            client.send(new HeadObjectCommand({ Bucket: 'storage-test', Key: source.key })),
        ).resolves.toMatchObject({
            ContentLength: body.length,
            ContentType: 'image/png',
            CacheControl: 'no-store',
        });
        await expect(
            client.send(new HeadObjectCommand({ Bucket: 'storage-test', Key: destinationKey })),
        ).resolves.toMatchObject({
            ContentLength: body.length,
            ContentType: 'image/webp',
            CacheControl: 'public, max-age=31536000, s-maxage=31536000, immutable',
        });
    });

    it('treats repeated deletion and a missing source as successful cleanup', async () => {
        const source = await uploadSource();

        await expect(storage.deleteObject(source.key)).resolves.toBeUndefined();
        await expect(storage.deleteObject(source.key)).resolves.toBeUndefined();
        await expect(storage.headObject(source.key)).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
});
