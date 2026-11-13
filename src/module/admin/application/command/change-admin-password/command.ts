/**
 * @file command.ts
 * @description Defines the ChangeAdminPasswordCommand for changing an admin's password.
 */

import { Command } from '@nestjs/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';

/**
 * Command to change an existing admin's password.
 */
export class ChangeAdminPasswordCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param idempotencyRequest Logical request identity and canonical semantic input.
     * @param id The unique identifier of the admin
     * @param currentPassword The admin's current password
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
