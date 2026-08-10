/**
 * @file command.ts
 * @description Defines the ChangeUserPasswordCommand for changing a user's password, together with the use case's client-safe rejection vocabulary.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Enum defining the client-safe messages of change-password rejections. Lives with the command
 * because the vocabulary belongs to this use case, not to the shared exception taxonomy.
 */
export enum ChangeUserPasswordMessage {
    /**
     * Targets incorrect current password submissions.
     */
    CURRENT_PASSWORD_MISMATCH = 'The current password provided is incorrect.',
    /**
     * Targets password reuse violations.
     */
    PASSWORD_REUSE = 'New password cannot be the same as the current password.',
}

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
