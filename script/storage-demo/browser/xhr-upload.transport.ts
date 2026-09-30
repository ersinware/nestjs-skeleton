/**
 * @file xhr-upload.transport.ts
 * @description XHR implementation of browser PUT transport.
 */

import type { PutResult, SignedUploadRequest, UploadTransport } from './upload-contract';
import { parseUploadError, UploadError } from './upload-error';

/**
 * XHR transport preserves upload progress and required signed headers.
 */
export class XhrUploadTransport implements UploadTransport {
    /**
     * Sends a single signed PUT and reports its actual response.
     *
     * @param request Signed request.
     * @param body Whole file or part slice.
     * @param signal Cancellation signal.
     * @param timeoutMs Request timeout.
     * @param onProgress Bytes sent on this attempt.
     * @returns Provider ETag when exposed.
     */
    put(
        request: SignedUploadRequest,
        body: Blob,
        signal: AbortSignal,
        timeoutMs: number,
        onProgress: (bytes: number) => void,
    ): Promise<PutResult> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const abort = (): void => xhr.abort();
            xhr.open('PUT', request.url);
            xhr.timeout = timeoutMs;
            for (const [name, value] of Object.entries(request.headers)) {
                xhr.setRequestHeader(name, value);
            }
            xhr.upload.onprogress = (event): void => onProgress(Math.min(event.loaded, body.size));
            xhr.onload = (): void => {
                signal.removeEventListener('abort', abort);
                if (xhr.status >= 200 && xhr.status < 300) {
                    const etag = xhr.getResponseHeader('ETag');
                    resolve(etag ? { etag } : {});
                } else {
                    reject(parseUploadError(xhr.status, xhr.responseText));
                }
            };
            xhr.onerror = (): void => {
                signal.removeEventListener('abort', abort);
                reject(
                    new UploadError(
                        'Upload connection failed; the browser cannot distinguish network and CORS errors.',
                        undefined,
                        undefined,
                        true,
                    ),
                );
            };
            xhr.ontimeout = (): void => {
                signal.removeEventListener('abort', abort);
                reject(new UploadError('Upload request timed out.', undefined, undefined, true));
            };
            xhr.onabort = (): void => {
                signal.removeEventListener('abort', abort);
                reject(new DOMException('Upload aborted.', 'AbortError'));
            };
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) {
                abort();
                return;
            }
            xhr.send(body);
        });
    }
}
