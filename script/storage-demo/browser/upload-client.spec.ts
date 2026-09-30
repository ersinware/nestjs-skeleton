/**
 * @file upload-client.spec.ts
 * @description Observable browser upload behavior with a controlled transport and clock.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadClient } from './upload-client';
import type {
    BrowserUploadPlan,
    PutResult,
    SignedUploadRequest,
    UploadOwner,
    UploadProgress,
    UploadTransport,
} from './upload-contract';
import { UploadError, parseUploadApiResponse, parseUploadError } from './upload-error';

/**
 * One controllable PUT observed by the fake transport.
 */
type PendingPut = {
    /**
     * Signed request under test.
     */
    readonly request: SignedUploadRequest;
    /**
     * Exact bytes sent.
     */
    readonly body: Blob;
    /**
     * Reports provisional bytes for this attempt.
     */
    readonly progress: (bytes: number) => void;
    /**
     * Completes the request with a provider response.
     */
    readonly succeed: (etag?: string) => void;
    /**
     * Fails the request with an observed error.
     */
    readonly fail: (error: Error) => void;
};

/**
 * Controllable PUT transport that honors abort and counts active requests.
 */
class ControlledTransport implements UploadTransport {
    readonly calls: PendingPut[] = [];
    active = 0;
    maxActive = 0;

    /**
     * Records one request until the test settles or aborts it.
     *
     * @param request Signed PUT request.
     * @param body Body sent to S3.
     * @param signal Request abort signal.
     * @param timeoutMs Unused because the test controls settlement.
     * @param onProgress Reports in-flight bytes.
     * @returns Controlled provider result.
     */
    put(
        request: SignedUploadRequest,
        body: Blob,
        signal: AbortSignal,
        _timeoutMs: number,
        onProgress: (bytes: number) => void,
    ): Promise<PutResult> {
        this.active++;
        this.maxActive = Math.max(this.maxActive, this.active);
        return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (action: () => void): void => {
                if (settled) {
                    return;
                }
                settled = true;
                signal.removeEventListener('abort', abort);
                this.active--;
                action();
            };
            const abort = (): void => settle(() => reject(new DOMException('Aborted.', 'AbortError')));
            signal.addEventListener('abort', abort, { once: true });
            this.calls.push({
                request,
                body,
                progress: onProgress,
                succeed: (etag) => settle(() => resolve(etag ? { etag } : {})),
                fail: (error) => settle(() => reject(error)),
            });
            if (signal.aborted) {
                abort();
            }
        });
    }
}

/**
 * Creates a signed request whose URL has no real network target.
 *
 * @param suffix Identifies the request in assertions.
 * @param expiresAt Absolute expiry.
 * @returns Signed browser request.
 */
function signedRequest(suffix: string, expiresAt = new Date(Date.now() + 60_000)): SignedUploadRequest {
    return {
        url: `https://example.invalid/${suffix}`,
        headers: { 'if-none-match': '*' },
        expiresAt,
    };
}

/**
 * Creates a small immutable browser File.
 *
 * @param name Display name.
 * @param size Number of bytes.
 * @returns Browser File.
 */
function file(name: string, size: number): File {
    return new File([new Uint8Array(size)], name, { type: 'image/png' });
}

/**
 * Creates a workflow that can expose each owner boundary to a test.
 *
 * @param plan Authorized upload plan.
 * @returns Instrumented owner callbacks.
 */
function ownerFor(plan: BrowserUploadPlan) {
    return {
        initiate: vi.fn(() => Promise.resolve(plan)),
        completeMultipart: vi.fn(() => Promise.resolve()),
        reconcile: vi.fn(() => Promise.resolve(false)),
        finalize: vi.fn(() => Promise.resolve()),
        isCurrent: vi.fn(() => true),
    } satisfies UploadOwner;
}

/**
 * Waits for asynchronous scheduling without sleeping for a fixed duration.
 *
 * @param assertion Observable condition.
 */
async function eventually(assertion: () => void): Promise<void> {
    await vi.waitFor(assertion, { timeout: 1_000 });
}

describe('UploadClient', () => {
    beforeEach(() => {
        vi.stubGlobal('window', new EventTarget());
        vi.stubGlobal('navigator', { onLine: true });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('keeps same-named files and their progress independent', async () => {
        const transport = new ControlledTransport();
        const selectedA = file('avatar.png', 3);
        const selectedB = file('avatar.png', 5);
        const ownerA = ownerFor({ mode: 'single', request: signedRequest('a') });
        const ownerB = ownerFor({ mode: 'single', request: signedRequest('b') });
        const clientA = new UploadClient(selectedA, ownerA, transport);
        const clientB = new UploadClient(selectedB, ownerB, transport);

        const first = clientA.start();
        const second = clientB.start();
        await eventually(() => expect(transport.calls).toHaveLength(2));
        transport.calls[1]?.succeed();
        transport.calls[0]?.succeed();
        await Promise.all([first, second]);

        expect(clientA.progress).toEqual({ state: 'uploaded', completedBytes: 3, transferredBytes: 3, totalBytes: 3 });
        expect(clientB.progress).toEqual({ state: 'uploaded', completedBytes: 5, transferredBytes: 5, totalBytes: 5 });
        expect(ownerA.finalize).toHaveBeenCalledOnce();
        expect(ownerB.finalize).toHaveBeenCalledOnce();
    });

    it('bounds multipart requests and completes only confirmed parts in order', async () => {
        const transport = new ControlledTransport();
        const plan: BrowserUploadPlan = {
            mode: 'multipart',
            uploadId: 'session',
            partSizeBytes: 5,
            partCount: 3,
            parts: [1, 2, 3].map((partNumber) => ({
                partNumber,
                request: signedRequest(`part/${partNumber}`),
            })),
        };
        const owner = ownerFor(plan);
        const client = new UploadClient(file('large.png', 12), owner, transport, { concurrency: 2 });
        const running = client.start();

        await eventually(() => expect(transport.calls).toHaveLength(2));
        expect(transport.maxActive).toBe(2);
        transport.calls[1]?.succeed('"etag-2"');
        await eventually(() => expect(transport.calls).toHaveLength(3));
        expect(transport.calls.map((call) => call.body.size)).toEqual([5, 5, 2]);
        transport.calls[2]?.succeed('"etag-3"');
        transport.calls[0]?.succeed('"etag-1"');
        await running;

        expect(transport.maxActive).toBe(2);
        expect(owner.completeMultipart).toHaveBeenCalledWith(
            plan,
            [
                { partNumber: 1, etag: '"etag-1"' },
                { partNumber: 2, etag: '"etag-2"' },
                { partNumber: 3, etag: '"etag-3"' },
            ],
            expect.any(AbortSignal),
        );
        expect(client.progress.state).toBe('uploaded');
    });

    it('resumes after a rapid pause without spending an attempt', async () => {
        const transport = new ControlledTransport();
        const client = new UploadClient(
            file('pause.png', 4),
            ownerFor({ mode: 'single', request: signedRequest('pause') }),
            transport,
            { attempts: 1 },
        );
        const running = client.start();

        await eventually(() => expect(transport.calls).toHaveLength(1));
        client.pause();
        client.resume();
        await eventually(() => expect(transport.calls).toHaveLength(2));
        transport.calls[1]?.succeed();
        await running;

        expect(client.progress.state).toBe('uploaded');
        expect(transport.active).toBe(0);
    });

    it('cancels an in-flight PUT and never finalizes', async () => {
        const transport = new ControlledTransport();
        const owner = ownerFor({ mode: 'single', request: signedRequest('cancel') });
        const client = new UploadClient(file('cancel.png', 4), owner, transport);
        const running = client.start();

        await eventually(() => expect(transport.calls).toHaveLength(1));
        client.cancel();
        await expect(running).rejects.toMatchObject({ name: 'AbortError' });
        expect(client.progress.state).toBe('cancelled');
        expect(owner.finalize).not.toHaveBeenCalled();
        expect(transport.active).toBe(0);
    });

    it('reconciles a lost single PUT response after a conditional conflict', async () => {
        const transport = new ControlledTransport();
        const owner = ownerFor({ mode: 'single', request: signedRequest('lost') });
        owner.reconcile.mockResolvedValue(true);
        const client = new UploadClient(file('lost.png', 4), owner, transport, { attempts: 1 });
        const running = client.start();

        await eventually(() => expect(transport.calls).toHaveLength(1));
        transport.calls[0]?.fail(new UploadError('Precondition failed.', 412));
        await running;

        expect(owner.reconcile).toHaveBeenCalledOnce();
        expect(transport.calls).toHaveLength(1);
        expect(client.progress.completedBytes).toBe(4);
        expect(owner.finalize).toHaveBeenCalledOnce();
    });

    it('reconciles a lost multipart completion without repeating completed part PUTs', async () => {
        const plan: BrowserUploadPlan = {
            mode: 'multipart',
            uploadId: 'session',
            partSizeBytes: 5,
            partCount: 2,
            parts: [1, 2].map((partNumber) => ({ partNumber, request: signedRequest(`part/${partNumber}`) })),
        };
        const owner = ownerFor(plan);
        owner.completeMultipart.mockRejectedValue(new UploadError('No such upload.', 404, 'NoSuchUpload'));
        owner.reconcile.mockResolvedValue(true);
        const transport = new ControlledTransport();
        const client = new UploadClient(file('completed.png', 8), owner, transport);
        const running = client.start();

        await eventually(() => expect(transport.calls).toHaveLength(2));
        transport.calls[0]?.succeed('"etag-1"');
        transport.calls[1]?.succeed('"etag-2"');
        await running;

        expect(owner.completeMultipart).toHaveBeenCalledOnce();
        expect(owner.reconcile).toHaveBeenCalledOnce();
        expect(transport.calls).toHaveLength(2);
        expect(owner.finalize).toHaveBeenCalledOnce();
    });

    it('does not count bytes from a failed attempt twice', async () => {
        const transport = new ControlledTransport();
        const progress: UploadProgress[] = [];
        const client = new UploadClient(
            file('retry.png', 4),
            ownerFor({ mode: 'single', request: signedRequest('retry') }),
            transport,
            {
                attempts: 2,
                onProgress: (snapshot) => progress.push(snapshot),
            },
        );
        const running = client.start();

        await eventually(() => expect(transport.calls).toHaveLength(1));
        transport.calls[0]?.progress(4);
        transport.calls[0]?.fail(new UploadError('Connection lost.', undefined, undefined, true));
        await eventually(() => expect(transport.calls).toHaveLength(2));
        transport.calls[1]?.succeed();
        await running;

        expect(progress.every((snapshot) => snapshot.completedBytes <= 4 && snapshot.transferredBytes <= 4)).toBe(true);
        expect(client.progress.completedBytes).toBe(4);
    });

    it('uses the online event to retry without occupying a PUT slot while offline', async () => {
        const transport = new ControlledTransport();
        const owner = ownerFor({ mode: 'single', request: signedRequest('offline') });
        const client = new UploadClient(file('offline.png', 4), owner, transport, { attempts: 2 });
        const running = client.start();

        await eventually(() => expect(transport.calls).toHaveLength(1));
        (navigator as { onLine: boolean }).onLine = false;
        transport.calls[0]?.fail(new UploadError('Connection lost.', undefined, undefined, true));
        await eventually(() => expect(client.progress.state).toBe('retrying'));
        expect(transport.active).toBe(0);
        (navigator as { onLine: boolean }).onLine = true;
        window.dispatchEvent(new Event('online'));
        await eventually(() => expect(transport.calls).toHaveLength(2));
        transport.calls[1]?.succeed();
        await running;

        expect(client.progress.state).toBe('uploaded');
        expect(owner.initiate).toHaveBeenCalledOnce();
    });

    it('retries only an uncertain multipart part and retains successful parts', async () => {
        const plan: BrowserUploadPlan = {
            mode: 'multipart',
            uploadId: 'part-timeout',
            partSizeBytes: 5,
            partCount: 2,
            parts: [1, 2].map((partNumber) => ({ partNumber, request: signedRequest(`retry-part/${partNumber}`) })),
        };
        const transport = new ControlledTransport();
        const owner = ownerFor(plan);
        const client = new UploadClient(file('part-timeout.png', 8), owner, transport, { attempts: 2 });
        const running = client.start();

        await eventually(() => expect(transport.calls).toHaveLength(2));
        transport.calls[1]?.succeed('"etag-2"');
        transport.calls[0]?.fail(new UploadError('Request timed out.', undefined, undefined, true));
        await eventually(() => expect(client.progress.state).toBe('retrying'));
        window.dispatchEvent(new Event('online'));
        await eventually(() => expect(transport.calls).toHaveLength(3));
        expect(transport.calls.map((call) => call.request.url)).toEqual([
            'https://example.invalid/retry-part/1',
            'https://example.invalid/retry-part/2',
            'https://example.invalid/retry-part/1',
        ]);
        transport.calls[2]?.succeed('"etag-1"');
        await running;

        expect(owner.completeMultipart).toHaveBeenCalledWith(
            plan,
            [
                { partNumber: 1, etag: '"etag-1"' },
                { partNumber: 2, etag: '"etag-2"' },
            ],
            expect.any(AbortSignal),
        );
    });

    it('keeps transfer completion separate from workflow finalization', async () => {
        const transport = new ControlledTransport();
        const owner = ownerFor({ mode: 'single', request: signedRequest('finalize') });
        let finish: (() => void) | undefined;
        owner.finalize.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        );
        const client = new UploadClient(file('finalize.png', 4), owner, transport);
        const running = client.start();

        await eventually(() => expect(transport.calls).toHaveLength(1));
        transport.calls[0]?.succeed();
        await eventually(() => expect(client.progress.state).toBe('completing'));
        expect(client.progress.completedBytes).toBe(4);
        finish?.();
        await running;
        expect(client.progress.state).toBe('uploaded');
    });

    it('bounds an owner request that never responds', async () => {
        vi.useFakeTimers();
        const transport = new ControlledTransport();
        const owner = ownerFor({ mode: 'single', request: signedRequest('unreachable') });
        owner.initiate.mockImplementation(() => new Promise<BrowserUploadPlan>(() => undefined));
        const client = new UploadClient(file('unreachable.png', 4), owner, transport, {
            attempts: 1,
            requestTimeoutMs: 100,
        });
        const running = client.start();
        const rejected = expect(running).rejects.toThrow('workflow request timed out');

        await vi.advanceTimersByTimeAsync(101);
        await rejected;
        expect(client.progress.state).toBe('failed');
        expect(transport.calls).toHaveLength(0);
    });

    it('rejects an expired URL without asking the owner for another plan', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const put = vi.fn(() => Promise.reject(new UploadError('Network failed.', undefined, undefined, true)));
        const transport: UploadTransport = { put };
        const owner = ownerFor({ mode: 'single', request: signedRequest('short', new Date(Date.now() + 100)) });
        const client = new UploadClient(file('expired.png', 4), owner, transport, { attempts: 3 });
        const running = client.start();
        const rejected = expect(running).rejects.toMatchObject({ code: 'Expired' });

        await vi.advanceTimersByTimeAsync(1_000);
        await rejected;
        expect(client.progress.state).toBe('expired');
        expect(owner.initiate).toHaveBeenCalledOnce();
        expect(put).toHaveBeenCalledOnce();
        expect(owner.finalize).not.toHaveBeenCalled();
    });

    it('stops on a permanent signature error', async () => {
        const transport = new ControlledTransport();
        const owner = ownerFor({ mode: 'single', request: signedRequest('signature') });
        const client = new UploadClient(file('signature.png', 4), owner, transport);
        const running = client.start();
        const rejected = expect(running).rejects.toMatchObject({ status: 403 });

        await eventually(() => expect(transport.calls).toHaveLength(1));
        transport.calls[0]?.fail(new UploadError('Signature mismatch.', 403, 'SignatureDoesNotMatch'));
        await rejected;
        expect(transport.calls).toHaveLength(1);
        expect(owner.finalize).not.toHaveBeenCalled();
    });

    it('rejects a stale form before the owning workflow finalizes', async () => {
        const transport = new ControlledTransport();
        const owner = ownerFor({ mode: 'single', request: signedRequest('stale') });
        const client = new UploadClient(file('stale.png', 4), owner, transport);
        const running = client.start();
        const rejected = expect(running).rejects.toThrow('form or selected file changed');

        await eventually(() => expect(transport.calls).toHaveLength(1));
        owner.isCurrent.mockReturnValue(false);
        transport.calls[0]?.succeed();
        await rejected;
        expect(owner.finalize).not.toHaveBeenCalled();
    });
});

describe('upload response parsing', () => {
    it('accepts API data envelopes and reads JSON, XML, or empty error responses', async () => {
        await expect(
            parseUploadApiResponse<{ token: string }>(
                new Response(JSON.stringify({ data: { token: 'signed' } }), { status: 200 }),
            ),
        ).resolves.toEqual({ token: 'signed' });
        expect(parseUploadError(404, '<Error><Code>NoSuchUpload</Code><Message>Gone</Message></Error>')).toMatchObject({
            code: 'NoSuchUpload',
            message: 'Gone',
        });
        expect(parseUploadError(400, '')).toMatchObject({ status: 400, message: 'Upload request failed (HTTP 400).' });
        await expect(
            parseUploadApiResponse(
                new Response(JSON.stringify({ error: { code: 'Conflict', message: 'Taken' } }), { status: 409 }),
            ),
        ).rejects.toMatchObject({ code: 'Conflict', message: 'Taken' });
    });
});
