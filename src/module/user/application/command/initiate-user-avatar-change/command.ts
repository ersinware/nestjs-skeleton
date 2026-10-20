/**
 * @file command.ts
 * @description Contract for preparing an authenticated user profile avatar upload.
 */

import { Command } from '@nestjs/cqrs';
import type { StorageSignedRequest } from 'src/core/storage';
import type { AvatarUploadDescriptor } from 'src/shared/domain/avatar';

/**
 * Authorizes a profile upload without changing the account or scheduling delivery.
 */
export class InitiateUserAvatarChangeCommand extends Command<InitiateUserAvatarChangeResult> {
    /**
     * Initializes the owner identity and normalized profile form.
     *
     * @param id Account identified by the verified principal
     * @param avatar Required avatar file descriptor
     * @param name Optional name bound to a combined profile update
     */
    constructor(
        readonly id: string,
        readonly avatar: AvatarUploadDescriptor,
        readonly name?: string,
    ) {
        super();
    }
}

/**
 * Single PUT request and proof accepted only by the owning profile workflow.
 */
export type InitiateUserAvatarChangeResult = {
    /**
     * Avatar workflows permit only a single PUT.
     */
    readonly mode: 'single';

    /**
     * Signed request with required headers and deadline.
     */
    readonly request: StorageSignedRequest;

    /**
     * Form-bound proof supplied when accepting the uploaded avatar.
     */
    readonly uploadToken: string;
};
