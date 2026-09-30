/**
 * @file single-upload.e2e-spec.ts
 * @description Exercises conditional browser PUTs and HEAD reconciliation against pipeline-owned SeaweedFS.
 */

import { type IStoragePort, type StorageSignedRequest } from 'src/core/storage';
import { ResourceNotFoundException } from 'src/shared/exception';
import { putWithLostResponse } from 'test/shared/storage-response-loss';
import { createStorageTestFixture, type StorageTestFixture } from 'test/shared/storage-test.factory';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

describe('Single upload (storage port)', { timeout: 30_000 }, () => {
    let fixture: StorageTestFixture;
    let storage: IStoragePort;
    const body = Buffer.from('single upload contract bytes');

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
     * Allocates a run-owned key and obtains the adapter's single PUT contract.
     *
     * @param sizeBytes Caller-declared size, checked against HEAD after uploading.
     * @returns The object key and presigned request.
     */
    async function initiate(sizeBytes = body.length): Promise<{
        /**
         * Key inside the run-owned cleanup prefix.
         */
        readonly key: string;
        /**
         * Browser-facing upload instructions.
         */
        readonly signed: StorageSignedRequest;
    }> {
        const key = fixture.key();
        const plan = await storage.initiateUpload({
            key,
            sizeBytes,
            contentType: 'image/png',
            cache: { visibility: 'no-store' },
            deadline: new Date(Date.now() + 300_000),
        });
        if (plan.mode !== 'single') {
            throw new Error('Expected a single upload.');
        }
        return { key, signed: plan.request };
    }

    it('accepts the first PUT and rejects overwrite without changing the stored object', async () => {
        const { key, signed } = await initiate();
        const first = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body });
        await first.arrayBuffer();
        expect(first.status).toBe(200);
        expect(first.headers.get('etag')).toBeTruthy();
        const head = await storage.headObject(key);
        expect(head).toEqual({ sizeBytes: body.length, etag: first.headers.get('etag'), contentType: 'image/png' });

        const second = await fetch(signed.url, {
            method: 'PUT',
            headers: signed.headers,
            body: Buffer.from('attempted overwrite'),
        });
        await second.arrayBuffer();
        expect(second.status).toBe(412);
        await expect(storage.headObject(key)).resolves.toEqual(head);
    });

    it.each(['content-type', 'cache-control', 'if-none-match'])(
        'rejects missing or changed signed %s',
        async (header) => {
            const { key, signed } = await initiate();
            for (const value of [undefined, 'changed']) {
                const headers = { ...signed.headers };
                if (value === undefined) {
                    delete headers[header];
                } else {
                    headers[header] = value;
                }
                const response = await fetch(signed.url, { method: 'PUT', headers, body });
                const error = await response.text();
                expect(response.status).toBe(403);
                expect(error).toContain('SignatureDoesNotMatch');
                await expect(storage.headObject(key)).rejects.toBeInstanceOf(ResourceNotFoundException);
            }
        },
    );

    it('reports actual bytes through HEAD instead of trusting the declared upload size', async () => {
        const { key, signed } = await initiate(1);
        const response = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body });
        await response.arrayBuffer();
        expect(response.status).toBe(200);
        expect((await storage.headObject(key)).sizeBytes).toBe(body.length);
    });

    it('distinguishes an absent upload from a stored object', async () => {
        const { key } = await initiate();
        await expect(storage.headObject(key)).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it('reconciles a successful PUT whose response is lost before reaching the client', async () => {
        const { key, signed } = await initiate();
        await putWithLostResponse(signed, body);
        const head = await storage.headObject(key);
        expect(head.sizeBytes).toBe(body.length);
        expect(head.contentType).toBe('image/png');
        expect(head.etag).not.toBe('');
    });

    it('permits browser preflight and exposes the uploaded object ETag', async () => {
        const { signed } = await initiate();
        const preflight = await fetch(signed.url, {
            method: 'OPTIONS',
            headers: {
                origin: 'http://localhost:3000',
                'access-control-request-method': 'PUT',
                'access-control-request-headers': Object.keys(signed.headers).join(','),
            },
        });
        await preflight.arrayBuffer();
        expect(preflight.ok).toBe(true);
        expect(['*', 'http://localhost:3000']).toContain(preflight.headers.get('access-control-allow-origin'));
        expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT');
        const allowed = preflight.headers.get('access-control-allow-headers')?.toLowerCase();
        for (const header of Object.keys(signed.headers)) {
            expect(allowed === '*' || allowed?.includes(header)).toBe(true);
        }

        const response = await fetch(signed.url, {
            method: 'PUT',
            headers: { ...signed.headers, origin: 'http://localhost:3000' },
            body,
        });
        await response.arrayBuffer();
        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-expose-headers')?.toLowerCase()).toContain('etag');
    });
});
