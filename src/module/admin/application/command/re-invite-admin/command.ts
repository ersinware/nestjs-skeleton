/**
 * @file command.ts
 * @description Command that re-issues the activation invitation for a pending admin account, with its rejection vocabulary.
 */

import { Command } from '@nestjs/cqrs';

/**
 * The rejection vocabulary of the re-invite flow.
 */
export enum ReInviteAdminMessage {
    /** Producing a fresh activation link for an active account would be an account-takeover tool. */
    ALREADY_ACTIVATED = 'The account has already been activated.',

    /** Inviting a banned account would promise an activation its ban forbids; lift the ban first. */
    BANNED = 'A banned account cannot be re-invited.',
}

/**
 * Re-issues the invitation for a pending admin whose link expired or never arrived. Invite tokens
 * are stateless, so earlier links stay valid until they expire or the account activates.
 */
export class ReInviteAdminCommand extends Command<void> {
    /**
     * Initializes the command with its payload.
     *
     * @param id The unique identifier of the pending admin
     */
    constructor(readonly id: string) {
        super();
    }
}
