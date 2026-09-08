/**
 * @file command.ts
 * @description Defines the BanUserCommand for banning a user account.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';
import type { Principal } from 'src/shared/domain/principal';

/**
 * Command to ban a user account. Invalidating: a ban flips the account's ban status, so it evicts the
 * public profile projection.
 */
export class BanUserCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user
     * @param actor The verified principal performing the action, weighed against the target by the aggregate
     */
    constructor(
        readonly id: string,
        readonly actor: Principal,
    ) {
        super();
    }

    /**
     * @returns The cache keys to evict on success — the user's cached projection
     */
    invalidatedKeys(): readonly string[] {
        return [CacheKeys.userById(this.id)];
    }
}
