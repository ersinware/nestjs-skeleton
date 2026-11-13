/**
 * @file command.ts
 * @description Command that activates a pending user account with emailed proof and its existing password.
 */

import { Command } from '@nestjs/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';

/**
 * Activates a pending user account without opening a session.
 */
export class ActivateUserCommand extends Command<void> {
    /**
     * Initializes the activation proof.
     *
     * @param idempotencyRequest Logical request identity and canonical semantic input.
     * @param token Activation token received at the account email address
     * @param password The account's existing plain-text password
     */
    constructor(
        readonly idempotencyRequest: IdempotencyRequest,
        readonly token: string,
        readonly password: string,
    ) {
        super();
    }
}
