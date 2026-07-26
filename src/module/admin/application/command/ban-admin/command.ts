/**
 * @file command.ts
 * @description Defines the command to ban an administrator account.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/admin/application/admin-cache-key.util';

/**
 * Command payload to ban an admin account by ID. Invalidating: a ban flips the account's ban status,
 * so it evicts the auth-state read the guards consult.
 */
export class BanAdminCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin
     */
    constructor(readonly id: string) {
        super();
    }

    /**
     * The cache key this ban evicts: the admin's auth-state.
     *
     * @returns The cache keys to evict on success
     */
    invalidatedKeys(): string[] {
        return [CacheKeys.adminAuthState(this.id)];
    }
}
