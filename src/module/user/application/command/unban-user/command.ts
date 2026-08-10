/**
 * @file command.ts
 * @description Defines the UnbanUserCommand for lifting a ban on a user account.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Command to unban a user account. Invalidating: lifting a ban flips the account's ban status, so it
 * evicts the public profile projection.
 */
export class UnbanUserCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user
     */
    constructor(readonly id: string) {
        super();
    }

    /**
     * The cache key this unban evicts: the user's profile projection.
     *
     * @returns The cache keys to evict on success
     */
    invalidatedKeys(): string[] {
        return [CacheKeys.userById(this.id)];
    }
}
