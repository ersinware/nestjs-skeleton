/**
 * @file command.ts
 * @description Command that activates a pending admin account, with its rejection vocabulary.
 */

import { Command } from '@nestjs/cqrs';

/**
 * The single rejection of the activation flow: one message for every failure — bad signature,
 * expiry, or account state — so a probing caller cannot learn which accounts exist or their state.
 */
export enum ActivateAdminMessage {
    INVALID_INVITE = 'The invitation is invalid or has expired.',
}

/**
 * Why the activation flow rejected an attempt. Reaches the auditor alone, as the audit record's
 * `reason`; the client always sees {@link ActivateAdminMessage.INVALID_INVITE}.
 */
export enum ActivateAdminRejectionReason {
    INVALID_TOKEN = 'INVALID_TOKEN',
    INVITE_REVOKED = 'INVITE_REVOKED',
    ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
    ACCOUNT_BANNED = 'ACCOUNT_BANNED',
    ACCOUNT_ALREADY_ACTIVE = 'ACCOUNT_ALREADY_ACTIVE',
}

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
