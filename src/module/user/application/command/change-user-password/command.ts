/**
 * @file command.ts
 * @description Defines the ChangeUserPasswordCommand for changing a user's password, together with the use case's client-safe rejection vocabulary.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Enum defining the client-safe messages of change-password rejections. Lives with the command
 * because the vocabulary belongs to this use case, not to the shared exception taxonomy.
 */
export enum ChangeUserPasswordMessage {
    /**
     * Targets incorrect current password submissions.
     */
    CURRENT_PASSWORD_MISMATCH = 'The current password provided is incorrect.',
    /**
     * Targets password reuse violations.
     */
    PASSWORD_REUSE = 'New password cannot be the same as the current password.',
}

/**
 * Command to change an existing user's password. Invalidating: a password change bumps the session
 * version (revoking existing sessions), so it evicts the auth-state read. The public profile
 * projection is unaffected and deliberately not evicted.
 */
export class ChangeUserPasswordCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user
     * @param currentPassword The user's current password
     * @param newPassword The new password to set
     */
    constructor(
        readonly id: string,
        readonly currentPassword: string,
        readonly newPassword: string,
    ) {
        super();
    }

    /**
     * The cache key this password change evicts: the user's auth-state (session version bumped).
     *
     * @returns The cache keys to evict on success
     */
    invalidatedKeys(): string[] {
        return [CacheKeys.userAuthState(this.id)];
    }
}
