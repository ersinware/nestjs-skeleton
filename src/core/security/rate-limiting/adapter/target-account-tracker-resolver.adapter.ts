/**
 * @file target-account-tracker-resolver.adapter.ts
 * @description Derives target-account trackers from validated email input without account lookup.
 */

import { Injectable } from '@nestjs/common';
import { isEmail, maxLength, minLength } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { EMAIL_MAX_LENGTH, EMAIL_MIN_LENGTH, RequestValidationMessage } from 'src/core/http';
import type { IRateLimitTrackerResolverPort } from 'src/core/security/rate-limiting/port/rate-limit-tracker-resolver.port';
import type { RateLimitTrackerField } from 'src/core/security/rate-limiting/rate-limit-policy';
import { InvalidInputException, SystemException } from 'src/shared/exception';

/**
 * Applies the existing email field contract before pipes, without checking account existence.
 */
@Injectable()
export class TargetAccountTrackerResolverAdapter implements IRateLimitTrackerResolverPort {
    /**
     * Validates the configured email input and hashes it into a target-account tracker.
     *
     * @param request Request carrying the raw body, before DTO transformation and validation.
     * @param field Configured body property containing the target account email.
     * @returns Hexadecimal SHA-256 of the trimmed email, preserving its case and aliases.
     */
    resolve(request: FastifyRequest, field: RateLimitTrackerField): string {
        if (!field) {
            throw new SystemException('The target-account tracker requires a body field.', {
                context: {
                    class: TargetAccountTrackerResolverAdapter.name,
                    method: this.resolve.name,
                },
            });
        }

        const body = request.body;
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            throw new InvalidInputException(RequestValidationMessage.PAYLOAD);
        }

        const value = (body as Readonly<Record<string, unknown>>)[field];
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
}
