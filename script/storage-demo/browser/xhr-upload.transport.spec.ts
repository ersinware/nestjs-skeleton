/**
 * @file xhr-upload.transport.spec.ts
 * @description Browser XHR transport behavior at the signed PUT boundary.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SignedUploadRequest } from './upload-contract';
import { XhrUploadTransport } from './xhr-upload.transport';

/**
 * Minimal controlled XMLHttpRequest for signed PUT assertions.
 */
class FakeXhr {
    static last: FakeXhr;
    readonly upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
    readonly headers = new Map<string, string>();
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 200;
    responseText = '';
    timeout = 0;
    method = '';
    url = '';
    body: Blob | undefined;
    etag: string | null = null;

    /**
     * Exposes the current test request.
     */
    constructor() {
        FakeXhr.last = this;
    }

    /**
     * Captures the signed destination.
     *
     * @param method HTTP method.
     * @param url Signed URL.
     */
    open(method: string, url: string): void {
        this.method = method;
        this.url = url;
    }

    /**
     * Captures an exact caller-supplied header.
     *
     * @param name Header name.
     * @param value Header value.
     */
    setRequestHeader(name: string, value: string): void {
        this.headers.set(name, value);
    }

    /**
     * Returns the provider ETag.
     *
     * @param name Header name.
     * @returns ETag when exposed.
     */
    getResponseHeader(name: string): string | null {
        return name === 'ETag' ? this.etag : null;
    }

    /**
     * Captures the bytes to send.
     *
     * @param body PUT body.
     */
    send(body: Blob): void {
        this.body = body;
    }

    /**
     * Emits a browser abort.
     */
    abort(): void {
        this.onabort?.();
    }
}

describe('XhrUploadTransport', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends every signed header and exposes progress and the ETag', async () => {
        vi.stubGlobal('XMLHttpRequest', FakeXhr);
        const request: SignedUploadRequest = {
            url: 'https://example.invalid/object',
            headers: { 'if-none-match': '*', 'content-type': 'image/png' },
            expiresAt: new Date(Date.now() + 60_000),
        };
        const body = new Blob([new Uint8Array(4)]);
        const progress = vi.fn();
        const result = new XhrUploadTransport().put(request, body, new AbortController().signal, 500, progress);
        const xhr = FakeXhr.last;

        expect(xhr.method).toBe('PUT');
        expect(xhr.url).toBe(request.url);
        expect(xhr.headers).toEqual(new Map(Object.entries(request.headers)));
        expect(xhr.body).toBe(body);
        expect(xhr.timeout).toBe(500);
        xhr.upload.onprogress?.({ loaded: 3 });
        xhr.etag = '"part-etag"';
        xhr.status = 200;
        xhr.onload?.();

        await expect(result).resolves.toEqual({ etag: '"part-etag"' });
        expect(progress).toHaveBeenCalledWith(3);
    });

    it('aborts an in-flight request and parses S3 XML failures', async () => {
        vi.stubGlobal('XMLHttpRequest', FakeXhr);
        const request: SignedUploadRequest = {
            url: 'https://example.invalid/object',
            headers: {},
            expiresAt: new Date(Date.now() + 60_000),
        };
        const controller = new AbortController();
        const transport = new XhrUploadTransport();
        const cancelled = transport.put(request, new Blob(), controller.signal, 500, () => undefined);
        controller.abort();
        await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });

        const failed = transport.put(request, new Blob(), new AbortController().signal, 500, () => undefined);
        FakeXhr.last.status = 412;
        FakeXhr.last.responseText = '<Error><Code>PreconditionFailed</Code><Message>Occupied</Message></Error>';
        FakeXhr.last.onload?.();
        await expect(failed).rejects.toMatchObject({ status: 412, code: 'PreconditionFailed', message: 'Occupied' });
    });
});
