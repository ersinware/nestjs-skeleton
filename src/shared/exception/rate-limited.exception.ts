/**
 * @file rate-limited.exception.ts
 * @description Transport-neutral admission refusal with a typed retry delay.
 */

import { AppException, type AppExceptionOptions } from 'src/shared/exception/app.exception';
import { ExceptionKind } from 'src/shared/exception/exception-kind.enum';

/**
 * Public vocabulary for rate-limit refusals.
 */
export enum RateLimitedMessage {
    /**
     * Shared client-safe refusal text.
     */
    DEFAULT = 'Too many requests. Please try again later.',
}

/**
 * Signals a temporarily exhausted request budget without exposing its tracker or counter.
 */
export class RateLimitedException extends AppException {
    /**
     * Protocol-neutral admission refusal category.
     */
    override readonly kind = ExceptionKind.RATE_LIMITED;

    /**
     * Carries the first blocking counter's retry delay without exposing its identity.
     *
     * @param retryAfterSeconds Positive whole seconds remaining on the first blocking counter.
     * @param message Client-safe description.
     * @param options Original cause and optional diagnostic metadata.
     */
    constructor(
        readonly retryAfterSeconds: number,
        message: string = RateLimitedMessage.DEFAULT,
        options?: AppExceptionOptions,
    ) {
        super(message, options);
    }
}

/**
 * Narrows the typed retry delay structurally, independently of exception class identity.
 *
 * @param error Failure caught at a transport boundary.
 * @returns Whether this is a rate-limit refusal with a valid retry delay.
 */
export function isRateLimitedException(
    error: unknown,
): error is Pick<RateLimitedException, 'kind' | 'retryAfterSeconds'> {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const candidate = error as { readonly kind?: unknown; readonly retryAfterSeconds?: unknown };
    return (
        candidate.kind === ExceptionKind.RATE_LIMITED &&
        typeof candidate.retryAfterSeconds === 'number' &&
        Number.isSafeInteger(candidate.retryAfterSeconds) &&
        candidate.retryAfterSeconds > 0
    );
}
