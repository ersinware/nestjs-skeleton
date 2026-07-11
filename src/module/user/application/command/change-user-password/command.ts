/**
 * @file command.ts
 * @description Defines the ChangeUserPasswordCommand for changing a user's password.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to change an existing user's password.
 */
export class ChangeUserPasswordCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user
     * @param currentPassword The user's current password
     * @param newPassword The new password to set
     */
    constructor(
        readonly id: string,
        readonly currentPassword: string,
        readonly newPassword: string,
    ) {
        super();
    }
}
