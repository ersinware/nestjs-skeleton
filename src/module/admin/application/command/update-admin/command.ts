/**
 * @file command.ts
 * @description Defines optional name and uploaded avatar changes for an admin profile.
 */

import { Command } from '@nestjs/cqrs';
import type { AvatarUploadDescriptor } from 'src/shared/domain/avatar';

/**
 * Command to update an admin's name, avatar, or both.
 */
export class UpdateAdminCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin
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
}
