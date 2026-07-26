/**
 * @file command.ts
 * @description Defines the UpdateUserCommand for updating a user's profile details. Declares the
 * cache key it dirties so the command pipeline evicts the user's projection on success.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Command to update a user's basic profile details. Invalidating: a successful update evicts the
 * user's cached projection (shared key with the read side via CacheKeys).
 */
export class UpdateUserCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user
     * @param email The new email address (optional)
     * @param name The new name (optional)
     */
    constructor(
        readonly id: string,
        readonly email?: string,
        readonly name?: string,
    ) {
        super();
    }

    /**
     * The cache keys this update evicts: the updated user's projection.
     *
     * @returns The cache keys to evict on success
     */
    invalidatedKeys(): string[] {
        return [CacheKeys.userById(this.id)];
    }
}
