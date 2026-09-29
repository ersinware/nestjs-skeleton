/**
 * @file single-upload.e2e-spec.ts
 * @description Exercises conditional browser PUTs and HEAD reconciliation against pipeline-owned SeaweedFS.
 */

import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { TOKEN_STORAGE_PORT, type IStoragePort, type StorageSignedRequest } from 'src/core/storage';
import { ResourceNotFoundException } from 'src/shared/exception';
import { createStorageTestModule } from 'test/shared/storage-test.factory';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

describe('Single upload (SeaweedFS)', () => {
    let module: TestingModule;
    let storage: IStoragePort;
    const prefix = `contract/${randomUUID()}`;
    const keys = new Set<string>();
    const body = Buffer.from('single upload contract bytes');

    beforeAll(async () => {
        // Fixed local credentials and endpoint prevent fallback to a real AWS account.
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
     * Allocates a run-owned key and obtains the adapter's single PUT contract.
     *
     * @param sizeBytes Caller-declared size, checked against HEAD after uploading.
     * @returns The object key and presigned request.
     */
    async function initiate(sizeBytes = body.length): Promise<{
        /**
         * Key tracked for cleanup even if a test fails.
         */
        readonly key: string;
        /**
         * Browser-facing upload instructions.
         */
        readonly signed: StorageSignedRequest;
    }> {
        const key = `${prefix}/${randomUUID()}`;
        keys.add(key);
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

/**
 * Drops the downstream connection only after SeaweedFS has accepted the PUT.
 *
 * @param signed Upload instructions whose original signed Host is preserved through the proxy.
 * @param body Uploaded bytes.
 */
async function putWithLostResponse(signed: StorageSignedRequest, body: Buffer) {
    let upstreamStatus: number | undefined;
    const proxy = createServer((incoming, outgoing) => {
        const upstream = httpRequest(signed.url, { method: 'PUT', headers: incoming.headers }, (response) => {
            upstreamStatus = response.statusCode;
            response.resume();
            response.on('end', () => outgoing.destroy());
        });
        upstream.on('error', () => outgoing.destroy());
        incoming.pipe(upstream);
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');

    try {
        const url = new URL(signed.url);
        const upload = new Promise<void>((resolve, reject) => {
            const request = httpRequest(
                {
                    hostname: '127.0.0.1',
                    port: (proxy.address() as AddressInfo).port,
                    path: `${url.pathname}${url.search}`,
                    method: 'PUT',
                    headers: { ...signed.headers, host: url.host },
                    timeout: 5_000,
                },
                (response) => {
                    response.resume();
                    resolve();
                },
            );
            request.on('error', reject);
            request.on('timeout', () => request.destroy(new Error('Upload timed out.')));
            request.end(body);
        });
        await expect(upload).rejects.toMatchObject({ code: 'ECONNRESET' });
        expect(upstreamStatus).toBe(200);
    } finally {
        proxy.closeAllConnections();
        await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
    }
}
