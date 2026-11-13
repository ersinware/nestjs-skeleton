/**
 * @file command.ts
 * @description Defines the ChangeUserPasswordCommand for changing a user's password.
 */

import { Command } from '@nestjs/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';

/**
 * Command to change an existing user's password.
 */
export class ChangeUserPasswordCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param idempotencyRequest Logical request identity and canonical semantic input.
     * @param id The unique identifier of the user
     * @param currentPassword The user's current password
     * @param newPassword The new password to set
     */
    constructor(
        readonly idempotencyRequest: IdempotencyRequest,
        readonly id: string,
        readonly currentPassword: string,
        readonly newPassword: string,
    ) {
        super();
    }
}
