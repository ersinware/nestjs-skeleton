/**
 * @file command.ts
 * @description Command that creates a new admin account pending activation.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Creates a new admin account pending activation: it starts without a password and its owner
 * activates it through the emailed invitation. The role is always ADMIN — super-admins are minted
 * by the seed script only.
 */
export class CreateAdminCommand extends Command<void> {
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
