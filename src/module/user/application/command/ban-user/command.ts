/**
 * @file command.ts
 * @description Defines the BanUserCommand for banning a user account.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Command to ban a user account. Invalidating: a ban flips the account's ban status, so it evicts both
 * the public profile projection and the auth-state read the guards consult.
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
     * The cache keys this ban evicts: the user's profile projection and auth-state.
     *
     * @returns The cache keys to evict on success
     */
    invalidatedKeys(): string[] {
        return [CacheKeys.userById(this.id), CacheKeys.userAuthState(this.id)];
    }
}
