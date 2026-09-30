/**
 * @file object-copy.e2e-spec.ts
 * @description Copy metadata and idempotent source cleanup through the production storage module.
 */

import { type IStoragePort, type StorageObject } from 'src/core/storage';
import { ResourceNotFoundException } from 'src/shared/exception';
import { createStorageTestFixture, type StorageTestFixture } from 'test/shared/storage-test.factory';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

describe('Object copy and cleanup (storage port)', { timeout: 30_000 }, () => {
    let fixture: StorageTestFixture;
    let storage: IStoragePort;
    const body = Buffer.from('object copy contract bytes');

    beforeAll(async () => {
        fixture = await createStorageTestFixture();
        storage = fixture.storage;
    });

    afterEach(async () => {
        await fixture?.cleanup();
    }, 30_000);

    afterAll(async () => {
        await fixture?.close();
    }, 30_000);

    /**
     * Uploads one run-owned source object with pending-object cache metadata.
     *
     * @returns Source key and verified object descriptor.
     */
    async function uploadSource(): Promise<{ readonly key: string; readonly object: StorageObject }> {
        const key = fixture.key();
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
        const destinationKey = fixture.key();

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
        await expect(storage.headObject(destinationKey)).resolves.toMatchObject({
            sizeBytes: body.length,
            contentType: 'image/webp',
        });
        await expect(fixture.readCacheControl(source.key)).resolves.toBe('no-store');
        await expect(fixture.readCacheControl(destinationKey)).resolves.toBe(
            'public, max-age=31536000, s-maxage=31536000, immutable',
        );
    });

    it('treats repeated deletion and a missing source as successful cleanup', async () => {
        const source = await uploadSource();

        await expect(storage.deleteObject(source.key)).resolves.toBeUndefined();
        await expect(storage.deleteObject(source.key)).resolves.toBeUndefined();
        await expect(storage.headObject(source.key)).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
});
