/**
 * @file command.ts
 * @description Defines the command for inviting a new admin.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Invites a new admin by creating an account pending activation: it starts without a password and its owner
 * activates it through the emailed invitation. It starts with no permissions: authority is granted
 * afterwards, by an admin who holds it.
 */
export class InviteAdminCommand extends Command<void> {
    /**
     * Initializes the command with its payload.
     *
     * @param email The unique email address the invitation is sent to
     * @param name The display name of the new admin
     */
    constructor(
        readonly email: string,
        readonly name: string,
    ) {
        super();
    }
}
