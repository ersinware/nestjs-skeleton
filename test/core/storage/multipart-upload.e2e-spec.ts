/**
 * @file multipart-upload.e2e-spec.ts
 * @description Multipart lifecycle through the production storage module and isolated SeaweedFS.
 */

import { HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    TOKEN_STORAGE_PORT,
    type IStoragePort,
    type StorageCompleteMultipartRequest,
    type StorageUploadPlan,
} from 'src/core/storage';
import { TOKEN_S3_CLIENT } from 'src/core/storage/storage-client.token';
import {
    DependencyUnavailableException,
    InvalidInputException,
    ResourceConflictException,
    ResourceNotFoundException,
} from 'src/shared/exception';
import { createStorageTestModule } from 'test/shared/storage-test.factory';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

describe('Multipart upload (SeaweedFS)', () => {
    let module: TestingModule;
    let storage: IStoragePort;
    let client: S3Client;
    const prefix = `contract/${randomUUID()}`;
    const keys = new Set<string>();
    const sessions: { key: string; uploadId: string }[] = [];
    const body = Buffer.alloc(11 * 1024 * 1024, 97);

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
        for (const session of sessions.splice(0)) {
            try {
                await storage.abortMultipart(session);
            } catch (error) {
                if (!(error instanceof ResourceNotFoundException)) {
                    throw error;
                }
            }
        }
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
     * Creates a run-owned session whose parts and object are always cleaned up.
     *
     * @param key Optional shared key for conditional completion races.
     * @returns Session key and its signed multipart plan.
     */
    async function initiate(key = `${prefix}/${randomUUID()}`): Promise<{
        /**
         * Object key owned by this test.
         */
        readonly key: string;
        /**
         * Ordered part URLs and geometry.
         */
        readonly plan: Extract<StorageUploadPlan, { mode: 'multipart' }>;
    }> {
        keys.add(key);
        const plan = await storage.initiateUpload({
            key,
            sizeBytes: body.length,
            contentType: 'application/octet-stream',
            cache: { visibility: 'no-store' },
            deadline: new Date(Date.now() + 300_000),
        });
        if (plan.mode !== 'multipart') {
            throw new Error('Expected multipart upload.');
        }
        sessions.push({ key, uploadId: plan.uploadId });
        return { key, plan };
    }

    /**
     * Uploads Blob-equivalent byte slices without manually setting Content-Length.
     *
     * @param session Planned upload and object key.
     * @param bytes Payload with the planned length.
     * @returns The client-observed ETag manifest for completion.
     */
    async function upload(
        session: Awaited<ReturnType<typeof initiate>>,
        bytes = body,
    ): Promise<StorageCompleteMultipartRequest> {
        const { key, plan } = session;
        const parts = [];
        for (const part of plan.parts) {
            const start = (part.partNumber - 1) * plan.partSizeBytes;
            const response = await fetch(part.request.url, {
                method: 'PUT',
                headers: part.request.headers,
                body: bytes.subarray(start, Math.min(start + plan.partSizeBytes, bytes.length)),
            });
            await response.arrayBuffer();
            expect(response.status).toBe(200);
            const etag = response.headers.get('etag');
            if (!etag) {
                throw new Error('UploadPart did not return an ETag.');
            }
            parts.push({ partNumber: part.partNumber, etag });
        }
        return { key, uploadId: plan.uploadId, partCount: plan.partCount, parts };
    }

    it('completes three parts, preserves size/type, and never deletes the object on abort-after-complete', async () => {
        const session = await initiate();
        expect(session.plan.partCount).toBe(3);
        const manifest = await upload(session);
        await storage.completeMultipart(manifest);
        const head = await storage.headObject(session.key);
        expect(head).toMatchObject({ sizeBytes: body.length, contentType: 'application/octet-stream' });
        expect(head.etag).not.toBe('');
        await expect(
            client.send(new HeadObjectCommand({ Bucket: 'storage-test', Key: session.key })),
        ).resolves.toMatchObject({
            ContentLength: body.length,
            ContentType: 'application/octet-stream',
            CacheControl: 'no-store',
        });
        // SeaweedFS 4.48 treats abort of a completed session as an idempotent success.
        await expect(storage.abortMultipart(manifest)).resolves.toBeUndefined();
        await expect(storage.headObject(session.key)).resolves.toEqual(head);
    });

    it('rejects a short non-final part and an oversized final part through the signature', async () => {
        const { key, plan } = await initiate();
        for (const [index, size] of [
            [0, plan.partSizeBytes - 1],
            [2, 1024 * 1024 + 1],
        ] as const) {
            const signed = plan.parts[index]!.request;
            const response = await fetch(signed.url, {
                method: 'PUT',
                headers: signed.headers,
                body: body.subarray(0, size),
            });
            expect(response.status).toBe(403);
            expect(await response.text()).toContain('SignatureDoesNotMatch');
        }
        await expect(storage.headObject(key)).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it('rejects missing, repeated, unsorted, and wrong-ETag manifests without publishing the object', async () => {
        const session = await initiate();
        const manifest = await upload(session);
        for (const parts of [
            manifest.parts.slice(0, 2),
            [manifest.parts[0]!, manifest.parts[0]!, manifest.parts[2]!],
            [...manifest.parts].reverse(),
            [...manifest.parts.slice(0, 2), { partNumber: 3, etag: '"wrong-etag"' }],
        ]) {
            await expect(storage.completeMultipart({ ...manifest, parts })).rejects.toBeInstanceOf(
                InvalidInputException,
            );
            await expect(storage.headObject(session.key)).rejects.toBeInstanceOf(ResourceNotFoundException);
        }
        await storage.completeMultipart(manifest);
    });

    it('reports NoSuchUpload in SeaweedFS when completing a session with no uploaded parts', async () => {
        const { key, plan } = await initiate();
        await expect(
            storage.completeMultipart({
                key,
                uploadId: plan.uploadId,
                partCount: plan.partCount,
                parts: plan.parts.map((part) => ({ partNumber: part.partNumber, etag: '"missing"' })),
            }),
        ).rejects.toBeInstanceOf(ResourceNotFoundException);
        await expect(storage.headObject(key)).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it('exercises competing completions and exposes the SeaweedFS conditional-write race limitation', async () => {
        const first = await initiate();
        const second = await initiate(first.key);
        const manifests = await Promise.all([upload(first), upload(second, Buffer.alloc(body.length, 98))]);
        const results = await Promise.allSettled(manifests.map((manifest) => storage.completeMultipart(manifest)));
        const successes = results.filter((result) => result.status === 'fulfilled').length;
        expect(successes).toBeGreaterThanOrEqual(1);
        for (const result of results) {
            if (result.status === 'rejected') {
                expect(result.reason).toBeInstanceOf(ResourceConflictException);
            }
        }
        if (successes === 2) {
            console.warn(
                'SeaweedFS 4.48 accepted both conditional completions; atomic exclusion must pass AWS acceptance in phase 22.',
            );
        }
        expect((await storage.headObject(first.key)).sizeBytes).toBe(body.length);
    });

    it('rejects completion against an occupied key with 412 and preserves the existing object', async () => {
        const first = await initiate();
        const second = await initiate(first.key);
        const manifests = await Promise.all([upload(first), upload(second, Buffer.alloc(body.length, 98))]);
        await storage.completeMultipart(manifests[0]);
        const head = await storage.headObject(first.key);
        await expect(storage.completeMultipart(manifests[1])).rejects.toMatchObject({
            cause: { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } },
        });
        await expect(storage.headObject(first.key)).resolves.toEqual(head);
    });

    it('aborts uploaded parts and refuses subsequent completion', async () => {
        const manifest = await upload(await initiate());
        await storage.abortMultipart(manifest);
        await expect(storage.completeMultipart(manifest)).rejects.toBeInstanceOf(ResourceNotFoundException);
        await expect(storage.headObject(manifest.key)).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it('retries a part after a lost response and completes using the retry ETag', async () => {
        const session = await initiate();
        const signed = session.plan.parts[0]!.request;
        await withLostResponse(async (port) => {
            const url = new URL(signed.url);
            const response = new Promise<void>((resolve, reject) => {
                const request = httpRequest(
                    {
                        hostname: '127.0.0.1',
                        port,
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
                request.end(body.subarray(0, session.plan.partSizeBytes));
            });
            await expect(response).rejects.toMatchObject({ code: 'ECONNRESET' });
        });
        await storage.completeMultipart(await upload(session));
        expect((await storage.headObject(session.key)).sizeBytes).toBe(body.length);
    });

    it('reconciles a lost completion response with HEAD without treating the timeout as failure to upload', async () => {
        const manifest = await upload(await initiate());
        await withLostResponse(async (port) => {
            const handler = client.config.requestHandler;
            client.config.requestHandler = {
                handle: (request, options) => handler.handle({ ...request, port }, options),
            };
            try {
                await expect(storage.completeMultipart(manifest)).rejects.toBeInstanceOf(
                    DependencyUnavailableException,
                );
            } finally {
                client.config.requestHandler = handler;
            }
        });
        const head = await storage.headObject(manifest.key);
        expect(head.sizeBytes).toBe(body.length);
        await expect(storage.completeMultipart(manifest)).rejects.toMatchObject({
            cause: { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } },
        });
        await expect(storage.headObject(manifest.key)).resolves.toEqual(head);
    });
});

/**
 * Drops the response only after the real provider has finished accepting a request.
 *
 * @param action Request directed through the proxy, preserving the original signed Host.
 */
async function withLostResponse(action: (port: number) => Promise<void>) {
    const upstreamStatuses: (number | undefined)[] = [];
    const proxy = createServer((incoming, outgoing) => {
        const upstream = httpRequest(
            `http://127.0.0.1:8333${incoming.url}`,
            {
                method: incoming.method,
                headers: incoming.headers,
            },
            (response) => {
                upstreamStatuses.push(response.statusCode);
                response.resume();
                response.on('end', () => outgoing.destroy());
            },
        );
        upstream.on('error', () => outgoing.destroy());
        incoming.pipe(upstream);
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    try {
        await action((proxy.address() as AddressInfo).port);
        expect(upstreamStatuses[0]).toBe(200);
        // SDK retries after a lost completion can encounter the newly created object.
        expect(upstreamStatuses.slice(1).every((status) => status === 412)).toBe(true);
    } finally {
        proxy.closeAllConnections();
        await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
    }
}
