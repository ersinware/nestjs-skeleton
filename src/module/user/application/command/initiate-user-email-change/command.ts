/**
 * @file command.ts
 * @description Initiates an email change requiring current-password verification.
 */

import { Command } from '@nestjs/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';

/**
 * Initiates email verification with a new confirmation link for the authenticated user.
 */
export class InitiateUserEmailChangeCommand extends Command<void> {
    /**
     * Initializes the self-service request.
     *
     * @param idempotencyRequest Validated client key and canonical endpoint semantics
     * @param id Account identifier from the verified principal
     * @param newEmail Validated and normalized target address
     * @param password Unmodified current password supplied by the caller
     */
    constructor(
        readonly idempotencyRequest: IdempotencyRequest,
        readonly id: string,
        readonly newEmail: string,
        readonly password: string,
    ) {
        super();
    }
}
