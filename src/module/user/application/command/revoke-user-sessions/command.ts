/**
 * @file command.ts
 * @description Defines the RevokeUserSessionsCommand, dispatched when auth reports refresh-token reuse
 * for a user so the user module can revoke every session and warn the account owner.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Command to revoke all of a user's sessions after refresh-token reuse was detected. Invalidating: the
 * revocation bumps the session version, so it evicts the auth-state read the guards consult.
 */
export class RevokeUserSessionsCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user whose sessions must be revoked
     * @param integrationEventId The originating reuse integration event id, used as the email idempotency key
     */
    constructor(
        readonly id: string,
        readonly integrationEventId: string,
    ) {
        super();
    }

    /**
     * The cache key this revocation evicts: the user's auth-state (session version bumped).
     *
     * @returns The cache keys to evict on success
     */
    invalidatedKeys(): string[] {
        return [CacheKeys.userAuthState(this.id)];
    }
}
