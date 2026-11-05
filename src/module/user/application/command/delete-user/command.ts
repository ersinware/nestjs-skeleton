/**
 * @file command.ts
 * @description Defines the DeleteUserCommand for soft deleting a user.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Command to softly delete an existing user. Invalidating: a soft delete removes the account from
 * every read, so it evicts the public profile projection.
 */
export class DeleteUserCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the command payload.
     *
     * @param idempotencyRequest Validated client key and canonical endpoint and principal semantics
     * @param id The unique identifier of the user to delete
     */
    constructor(
        readonly idempotencyRequest: IdempotencyRequest,
        readonly id: string,
    ) {
        super();
    }

    /**
     * Identifies the cached user projection invalidated after this command succeeds.
     *
     * @returns The cache keys to evict on success — the user's cached projection
     */
    invalidatedKeys(): readonly string[] {
        return [CacheKeys.userById(this.id)];
    }
}
