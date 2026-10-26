/**
 * @file target-account-tracker-resolver.adapter.ts
 * @description Derives target-account trackers from validated email or route ID input without account lookup.
 */

import { Injectable } from '@nestjs/common';
import { isEmail, isUUID, maxLength, minLength } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { EMAIL_MAX_LENGTH, EMAIL_MIN_LENGTH, PARAM_ID, RequestValidationMessage } from 'src/core/http';
import type { IRateLimitTrackerResolverPort } from 'src/core/security/rate-limiting/port/rate-limit-tracker-resolver.port';
import { RateLimitTrackerField } from 'src/core/security/rate-limiting/rate-limit-policy';
import { InvalidInputException, SystemException } from 'src/shared/exception';

/**
 * Applies the owning workflow's field contract before pipes, without checking account existence.
 */
@Injectable()
export class TargetAccountTrackerResolverAdapter implements IRateLimitTrackerResolverPort {
    /**
     * Validates the configured target input and returns its canonical tracker.
     *
     * @param request Request carrying raw body and route parameters before DTO validation.
     * @param field Selector for the target email body field or resource ID route parameter.
     * @returns Lowercase UUID v7 or SHA-256 of the trimmed, case-preserved email.
     */
    resolve(request: FastifyRequest, field: RateLimitTrackerField): string {
        switch (field) {
            case RateLimitTrackerField.TARGET_EMAIL:
                return this.resolveEmail(request);
            case RateLimitTrackerField.TARGET_ID:
                return this.resolveId(request);
            default:
                return this.assertTrackerFieldExhausted(field);
        }
    }

    /**
     * Matches email DTO normalization without changing case or provider aliases.
     *
     * @param request Request carrying the unvalidated target email body.
     * @returns SHA-256 of the validated trimmed email.
     */
    private resolveEmail(request: FastifyRequest): string {
        const body = request.body;
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            throw new InvalidInputException(RequestValidationMessage.PAYLOAD);
        }

        const value = (body as Readonly<Record<string, unknown>>)[RateLimitTrackerField.TARGET_EMAIL];
        if (typeof value !== 'string') {
            throw new InvalidInputException(RequestValidationMessage.PAYLOAD);
        }

        // Match IsEmailAddress's Trim transformation; case and provider aliases remain significant.
        const email = value.trim();
        if (!minLength(email, EMAIL_MIN_LENGTH) || !maxLength(email, EMAIL_MAX_LENGTH) || !isEmail(email)) {
            throw new InvalidInputException(RequestValidationMessage.PAYLOAD);
        }

        return createHash('sha256').update(email).digest('hex');
    }

    /**
     * Validates the resource ID route parameter and canonicalizes UUID case.
     *
     * @param request Request carrying the unvalidated target ID route parameter.
     * @returns Lowercase UUID v7.
     */
    private resolveId(request: FastifyRequest): string {
        const params = request.params;
        if (params === null || typeof params !== 'object' || Array.isArray(params)) {
            throw new InvalidInputException(RequestValidationMessage.PARAM);
        }

        const value = (params as Readonly<Record<string, unknown>>)[PARAM_ID];
        if (typeof value !== 'string' || !isUUID(value, '7')) {
            throw new InvalidInputException(RequestValidationMessage.PARAM);
        }

        return value.toLowerCase();
    }

    /**
     * Rejects unsupported target selectors and enforces exhaustive field handling.
     *
     * @param field Unhandled field selector.
     * @throws {SystemException} When the configured target field is unsupported.
     */
    private assertTrackerFieldExhausted(field: never): never {
        throw new SystemException('The target-account tracker requires a supported field.', {
            context: {
                class: TargetAccountTrackerResolverAdapter.name,
                method: this.resolve.name,
                field,
            },
        });
    }
}
