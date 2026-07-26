/**
 * @file command.ts
 * @description Defines the DeleteUserCommand for soft deleting a user.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Command to softly delete an existing user. Invalidating: a soft delete removes the account from
 * every read, so it evicts both the public profile projection and the auth-state read.
 */
export class DeleteUserCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user to delete
     */
    constructor(readonly id: string) {
        super();
    }

    /**
     * The cache keys this deletion evicts: the user's profile projection and auth-state.
     *
     * @returns The cache keys to evict on success
     */
    invalidatedKeys(): string[] {
        return [CacheKeys.userById(this.id), CacheKeys.userAuthState(this.id)];
    }
}
