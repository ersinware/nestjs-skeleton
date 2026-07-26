/**
 * @file command.ts
 * @description Defines the command to soft-delete an administrator account.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/admin/application/admin-cache-key.util';

/**
 * Command payload to initiate the deletion of an admin account by ID. Invalidating: a soft delete
 * removes the account from every read, so it evicts the auth-state read.
 */
export class DeleteAdminCommand extends Command<void> implements ICacheInvalidatingCommand {
    constructor(readonly id: string) {
        super();
    }

    /**
     * The cache key this deletion evicts: the admin's auth-state.
     *
     * @returns The cache keys to evict on success
     */
    invalidatedKeys(): string[] {
        return [CacheKeys.adminAuthState(this.id)];
    }
}
