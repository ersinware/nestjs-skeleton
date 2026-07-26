/**
 * @file command.ts
 * @description Defines the UnbanUserCommand for lifting a ban on a user account.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Command to unban a user account. Invalidating: lifting a ban flips the account's ban status, so it
 * evicts both the public profile projection and the auth-state read the guards consult.
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
     * The cache keys this unban evicts: the user's profile projection and auth-state.
     *
     * @returns The cache keys to evict on success
     */
    invalidatedKeys(): string[] {
        return [CacheKeys.userById(this.id), CacheKeys.userAuthState(this.id)];
    }
}
