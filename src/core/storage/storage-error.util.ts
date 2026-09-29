/**
 * @file storage-error.util.ts
 * @description Maps recognized storage failures to application exceptions.
 */

import {
    DependencyUnavailableException,
    DependencyUnavailableMessage,
    InvalidInputException,
    InvalidInputMessage,
    ResourceConflictException,
    ResourceConflictMessage,
    ResourceNotFoundException,
    ResourceNotFoundMessage,
    SystemException,
    toError,
    type ExceptionContext,
} from 'src/shared/exception';

/**
 * Node transport failures treated as storage outages.
 */
const CONNECTION_FAILURE_CODES: ReadonlySet<string> = new Set([
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPIPE',
    'ETIMEDOUT',
]);

/**
 * Provider fields needed to classify an unknown rejection.
 */
type StorageProviderError = {
    /**
     * Provider error name.
     */
    readonly name?: unknown;

    /**
     * Node transport error code.
     */
    readonly code?: unknown;

    /**
     * HTTP response metadata when the provider answered.
     */
    readonly $metadata?: {
        /**
         * Provider response status.
         */
        readonly httpStatusCode?: unknown;
    };
};

/**
 * Converts known provider failures for the adapter to throw; unknown errors keep their identity.
 *
 * @param error SDK or transport rejection.
 * @param context Adapter operation that observed the failure.
 * @returns A mapped application exception or the normalized original error.
 */
export function translateStorageError(error: unknown, context: ExceptionContext): Error {
    if (typeof error !== 'object' || error === null) {
        return toError(error);
    }

    const _error = error as StorageProviderError,
        name = typeof _error.name === 'string' ? _error.name : '';

    if (name === 'NoSuchBucket' || name === 'CredentialsProviderError') {
        return new SystemException(`Storage provider configuration failed (${name}).`, { cause: _error, context });
    }

    const status = _error.$metadata?.httpStatusCode;

    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey' || name === 'NoSuchUpload') {
        return new ResourceNotFoundException(ResourceNotFoundMessage.DEFAULT, { cause: _error });
    }

    if (['InvalidPart', 'InvalidPartOrder', 'EntityTooSmall'].includes(name)) {
        return new InvalidInputException(InvalidInputMessage.DEFAULT, { cause: _error });
    }

    if (status === 409 || status === 412 || name === 'ConditionalRequestConflict' || name === 'PreconditionFailed') {
        return new ResourceConflictException(ResourceConflictMessage.DEFAULT, { cause: _error });
    }

    if (
        status === 429 ||
        (typeof status === 'number' && status >= 500) ||
        CONNECTION_FAILURE_CODES.has(typeof _error.code === 'string' ? _error.code : '') ||
        ['TimeoutError', 'RequestTimeout', 'SlowDown', 'Throttling', 'AbortError'].includes(name)
    ) {
        return new DependencyUnavailableException(DependencyUnavailableMessage.DEFAULT, { cause: _error });
    }

    if (typeof status === 'number' && status >= 400 && status < 500) {
        return new SystemException(`Storage provider rejected the request (${status}, ${name || 'unknown'}).`, {
            cause: _error,
            context,
        });
    }

    return toError(_error);
}
