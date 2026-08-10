/**
 * @file command.ts
 * @description Defines the BanUserCommand for banning a user account.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Command to ban a user account. Invalidating: a ban flips the account's ban status, so it evicts the
 * public profile projection.
 */
export class BanUserCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user
     */
    constructor(readonly id: string) {
        super();
    }

    /**
     * @returns The cache keys to evict on success — the user's cached projection
     */
    invalidatedKeys(): string[] {
        return [CacheKeys.userById(this.id)];
    }
}
