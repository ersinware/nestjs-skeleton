/**
 * @file command.ts
 * @description Command that activates a pending admin account.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Activates a pending admin account: verifies the invite token and sets the first password, which
 * also kills every outstanding invite link.
 */
export class ActivateAdminCommand extends Command<void> {
    /**
     * Initializes the command with its payload.
     *
     * @param token The invite token from the invitation email
     * @param password The plain-text initial password chosen by the owner
     */
    constructor(
        readonly token: string,
        readonly password: string,
    ) {
        super();
    }
}
