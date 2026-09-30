/**
 * @file storage-response-loss.ts
 * @description Drops accepted storage responses while preserving signed requests and real provider effects.
 */

import type { S3Client } from '@aws-sdk/client-s3';
import type { NodeHttpHandler } from '@smithy/node-http-handler';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StorageSignedRequest } from 'src/core/storage';
import { expect } from 'vitest';

/**
 * Drops the downstream connection only after the provider has accepted the PUT.
 *
 * @param signed Upload instructions whose original signed Host is preserved through the proxy.
 * @param body Uploaded bytes.
 */
export async function putWithLostResponse(signed: StorageSignedRequest, body: Buffer) {
    let upstreamStatus: number | undefined;
    const proxy = createServer((incoming, outgoing) => {
        const upstream = httpRequest(
            signed.url,
            { method: 'PUT', headers: incoming.headers, timeout: 5_000 },
            (response) => {
                upstreamStatus = response.statusCode;
                response.resume();
                response.on('end', () => outgoing.destroy());
            },
        );
        upstream.on('timeout', () => upstream.destroy(new Error('Upstream upload timed out.')));
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

/**
 * Loses SDK responses after the actual provider finishes, including SDK retries.
 *
 * @param client Production client whose transport is temporarily wrapped.
 * @param action Port operation expected to observe a transport failure.
 */
export async function withLostStorageResponse(client: S3Client, action: () => Promise<void>) {
    const handler = client.config.requestHandler;
    const statuses: number[] = [];
    client.config.requestHandler = {
        handle: async (...args: Parameters<NodeHttpHandler['handle']>) => {
            const result = await (handler as NodeHttpHandler).handle(...args);
            statuses.push(result.response.statusCode);
            // NodeHttpHandler returns a readable body; drain it before losing the response.
            for await (const chunk of result.response.body as AsyncIterable<Uint8Array>) {
                void chunk;
            }
            throw Object.assign(new Error('Storage response lost after provider acceptance.'), { code: 'ECONNRESET' });
        },
    };
    try {
        await action();
        expect(statuses[0]).toBe(200);
    } finally {
        client.config.requestHandler = handler;
    }
}
