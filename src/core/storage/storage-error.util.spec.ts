/**
 * @file storage-error.util.spec.ts
 * @description Contract tests for S3 and transport failure classification.
 */

import { translateStorageError } from 'src/core/storage/storage-error.util';
import {
    DependencyUnavailableException,
    ResourceConflictException,
    ResourceNotFoundException,
    SystemException,
} from 'src/shared/exception';
import { describe, expect, it } from 'vitest';

/**
 * Adapter operation attached to diagnostic system failures.
 */
const context = { class: 'S3StorageAdapter', method: 'headObject' };

describe('translateStorageError', () => {
    it('maps a missing object to resource not found', () => {
        const missing = { name: 'NotFound', $metadata: { httpStatusCode: 404 } };
        expect(translateStorageError(missing, context)).toBeInstanceOf(ResourceNotFoundException);
    });

    it('does not mistake a missing bucket for a missing object', () => {
        const error = { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } };
        const mapped = translateStorageError(error, context);
        expect(mapped).toBeInstanceOf(SystemException);
        expect((mapped as SystemException).context).toEqual(context);
    });

    it('maps a missing credential provider to an operational failure', () => {
        expect(translateStorageError({ name: 'CredentialsProviderError' }, context)).toBeInstanceOf(SystemException);
    });

    it.each([409, 412])('maps S3 %s to a resource conflict', (status) => {
        const error = { name: 'PreconditionFailed', $metadata: { httpStatusCode: status } };
        expect(translateStorageError(error, context)).toBeInstanceOf(ResourceConflictException);
    });

    it.each([403, 400])('treats S3 %s as an operational failure', (status) => {
        const error = { name: 'AccessDenied', $metadata: { httpStatusCode: status } };
        const mapped = translateStorageError(error, context);
        expect(mapped).toBeInstanceOf(SystemException);
        expect((mapped as SystemException).context).toEqual(context);
    });

    it.each([429, 503])('treats S3 %s as transient', (status) => {
        const error = { name: 'SlowDown', $metadata: { httpStatusCode: status } };
        expect(translateStorageError(error, context)).toBeInstanceOf(DependencyUnavailableException);
    });

    it.each(['ECONNRESET', 'ENOTFOUND', 'EPIPE'])('classifies %s as a transport outage', (code) => {
        const error = Object.assign(new Error('transport failure'), { code });
        const mapped = translateStorageError(error, context);
        expect(mapped).toBeInstanceOf(DependencyUnavailableException);
        expect((mapped as DependencyUnavailableException).cause).toBe(error);
    });

    it('returns an unrecognized programming failure unchanged', () => {
        const error = new Error('unexpected');
        expect(translateStorageError(error, context)).toBe(error);
    });
});
