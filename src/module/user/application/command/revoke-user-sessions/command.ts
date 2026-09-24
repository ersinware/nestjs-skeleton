/**
 * @file command.ts
 * @description Command that revokes all of a user's sessions.
 */

import { Command } from '@nestjs/cqrs';
import type { SessionRevocationReason } from 'src/shared/domain/principal';

/**
 * Revokes all of a user's sessions. The reason decides whether the account owner is notified.
 */
export class RevokeUserSessionsCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user whose sessions must be revoked
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
