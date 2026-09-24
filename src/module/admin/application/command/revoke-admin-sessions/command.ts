/**
 * @file command.ts
 * @description Command that revokes all of an admin's sessions.
 */

import { Command } from '@nestjs/cqrs';
import type { SessionRevocationReason } from 'src/shared/domain/principal';

/**
 * Revokes all of an admin's sessions. The reason decides whether the account owner is notified.
 */
export class RevokeAdminSessionsCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin whose sessions must be revoked
     * @param reason Why the sessions are revoked
     * @param deliveryId Identifier of the job requesting this revocation
     */
    constructor(
        readonly id: string,
        readonly reason: SessionRevocationReason,
        readonly deliveryId: string,
    ) {
        super();
    }
}
