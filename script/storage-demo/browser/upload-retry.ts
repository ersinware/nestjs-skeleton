/**
 * @file upload-retry.ts
 * @description Bounded owner requests and retry classification for browser uploads.
 */

import { UploadError } from './upload-error';

/**
 * Bounds one workflow API call and forwards cancellation.
 *
 * @param operation Owner callback.
 * @param signal Whole-upload cancellation signal.
 * @param timeoutMs Per-request timeout.
 * @param assertCurrent Rejects a stale form or file.
 * @returns Owner response.
 */
export async function callUploadOwner<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
    timeoutMs: number,
    assertCurrent: () => void,
): Promise<T> {
    const controller = new AbortController();
    let rejectCancelled: ((reason: DOMException) => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
        rejectCancelled = reject;
    });
    const cancel = (): void => {
        controller.abort();
        rejectCancelled?.(new DOMException('Upload cancelled.', 'AbortError'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        assertCurrent();
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                reject(new UploadError('Upload workflow request timed out.', undefined, undefined, true));
                controller.abort();
            }, timeoutMs);
        });
        return await Promise.race([operation(controller.signal), timeout, cancelled]);
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
    }
}

/**
 * Identifies outcomes that may have succeeded despite the observed failure.
 *
 * @param error Observed failure.
 * @returns Whether server-side reconciliation can settle the result.
 */
export function isAmbiguousUploadError(error: unknown): boolean {
    return error instanceof UploadError && (error.ambiguous || error.status === 412 || error.code === 'NoSuchUpload');
}

/**
 * Limits retry to transient failures.
 *
 * @param error Observed failure.
 * @returns Whether another attempt is useful.
 */
export function isRetryableUploadError(error: unknown): boolean {
    return (
        error instanceof UploadError &&
        (error.ambiguous ||
            error.status === 408 ||
            error.status === 429 ||
            (error.status !== undefined && error.status >= 500))
    );
}

/**
 * Waits a bounded jittered delay; browser connectivity is only a hint.
 *
 * @param attempt Failed attempt number.
 * @param signal Whole-upload cancellation signal.
 */
export async function waitForUploadRetry(attempt: number, signal: AbortSignal): Promise<void> {
    const baseDelay = Math.min(5_000, 250 * 2 ** (attempt - 1)) * (0.5 + Math.random());
    const delay = navigator.onLine === false ? Math.max(baseDelay, 1_000) : baseDelay;
    await new Promise<void>((resolve, reject) => {
        const finish = (): void => {
            clearTimeout(timer);
            window.removeEventListener('online', finish);
            signal.removeEventListener('abort', abort);
            resolve();
        };
        const abort = (): void => {
            clearTimeout(timer);
            window.removeEventListener('online', finish);
            reject(new DOMException('Upload cancelled.', 'AbortError'));
        };
        const timer = setTimeout(finish, delay);
        window.addEventListener('online', finish, { once: true });
        signal.addEventListener('abort', abort, { once: true });
    });
}
