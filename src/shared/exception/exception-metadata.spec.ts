/**
 * @file exception-metadata.spec.ts
 * @description Verifies module-owned refusal vocabulary and preservation of thrown diagnostic values.
 */

/// <reference types="vitest/globals" />

import { defineAuditAction } from 'src/shared/domain/audit';
import { AccessDeniedException } from 'src/shared/exception/access-denied.exception';
import { isExceptionWithAudit } from 'src/shared/exception/app.exception';
import { ExceptionKind } from 'src/shared/exception/exception-kind.enum';
import { toError } from 'src/shared/exception/to-error.util';

describe('Exception metadata', () => {
    it('accepts module-owned audit actions without importing their vocabulary', () => {
        expect(
            isExceptionWithAudit(
                new AccessDeniedException('Denied', {
                    audit: { action: defineAuditAction('MODULE_UPDATE_FAILED'), reason: 'ACCOUNT_BANNED' },
                }),
            ),
        ).toBe(true);
    });

    it.each([
        { kind: ExceptionKind.ACCESS_DENIED },
        { kind: 'unknown', audit: { action: 'REFUSED', reason: 'reason' } },
        { kind: ExceptionKind.ACCESS_DENIED, audit: { action: '', reason: 'reason' } },
        { kind: ExceptionKind.ACCESS_DENIED, audit: { action: 'REFUSED', reason: null } },
    ])('rejects incomplete audit instructions: %j', (error) => {
        expect(isExceptionWithAudit(error)).toBe(false);
    });

    it('keeps existing errors and wraps non-errors with the original cause', () => {
        const error = new Error('original');
        expect(toError(error)).toBe(error);
        for (const value of ['thrown', null, { detail: 'failure' }]) {
            expect(toError(value).cause).toBe(value);
        }
        const value = {
            toString() {
                throw new Error('cannot stringify');
            },
        };
        const wrapped = toError(value);
        expect(wrapped.message).toBe('Non-Error value thrown');
        expect(wrapped.cause).toBe(value);
    });
});
