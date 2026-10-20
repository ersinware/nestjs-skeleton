/**
 * @file command.ts
 * @description Defines optional name and uploaded avatar changes for a user profile.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';
import type { AvatarUploadDescriptor } from 'src/shared/domain/avatar';

/**
 * Command to update a user's name, avatar, or both.
 */
export class UpdateUserCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user
     * @param name The new display name, omitted to preserve the current value
     * @param avatar Uploaded avatar descriptor, omitted to preserve the current avatar
     * @param uploadToken Upload proof required together with the avatar descriptor
     */
    constructor(
        readonly id: string,
        readonly name?: string,
        readonly avatar?: AvatarUploadDescriptor,
        readonly uploadToken?: string,
    ) {
        super();
    }

    /**
     * Evicts the same projection used by durable aggregate cache jobs.
     *
     * @returns Cache keys invalidated after successful reconciliation
     */
    invalidatedKeys(): readonly string[] {
        return [CacheKeys.userById(this.id)];
    }
}
