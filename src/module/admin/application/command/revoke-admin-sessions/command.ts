/**
 * @file command.ts
 * @description Defines the RevokeAdminSessionsCommand, dispatched when auth reports refresh-token reuse
 * for an admin so the admin module can revoke every session and warn the account owner.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/admin/application/admin-cache-key.util';

/**
 * Command to revoke all of an admin's sessions after refresh-token reuse was detected. Invalidating:
 * the revocation bumps the session version, so it evicts the auth-state read the guards consult.
 */
export class RevokeAdminSessionsCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin whose sessions must be revoked
     * @param integrationEventId The originating reuse integration event id, used as the email idempotency key
     */
    constructor(
        readonly id: string,
        readonly integrationEventId: string,
    ) {
        super();
    }

    /**
     * The cache key this revocation evicts: the admin's auth-state (session version bumped).
     *
     * @returns The cache keys to evict on success
     */
    invalidatedKeys(): string[] {
        return [CacheKeys.adminAuthState(this.id)];
    }
}
