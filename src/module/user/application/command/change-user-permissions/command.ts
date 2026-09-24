/**
 * @file command.ts
 * @description Command that replaces a user's permission set.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';
import type { Permission, Principal } from 'src/shared/domain/principal';

/**
 * Replaces a user's permission set with the given one. Whole-set semantics on purpose: the
 * request states the end state, so it is idempotent, and one command yields one audit record
 * naming everything granted and revoked. Invalidating: the permissions are part of the public
 * profile projection, so a change evicts it.
 */
export class ChangeUserPermissionsCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user whose permissions change
     * @param permissions The complete permission set the user should hold afterwards
     * @param actor The verified principal making the change
     */
    constructor(
        readonly id: string,
        readonly permissions: readonly Permission[],
        readonly actor: Principal,
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
