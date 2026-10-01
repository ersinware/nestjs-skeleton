/**
 * @file command.ts
 * @description Contract for preparing the user-owned account avatar upload.
 */

import { Command } from '@nestjs/cqrs';
import type { StorageSignedRequest } from 'src/core/storage';
import type { AvatarUploadDescriptor } from 'src/shared/domain/avatar';

/**
 * Authorizes a fresh form-bound upload attempt without persisting an upload session.
 */
export class InitiateUserRegistrationCommand extends Command<InitiateUserRegistrationResult> {
    /**
     * Initializes the validated account form and required file descriptor.
     *
     * @param email Validated and normalized registration email
     * @param name Validated and normalized display name
     * @param password Unmodified initial password
     * @param avatar Required avatar file details selected with this form
     */
    constructor(
        readonly email: string,
        readonly name: string,
        readonly password: string,
        readonly avatar: AvatarUploadDescriptor,
    ) {
        super();
    }
}

/**
 * The single PUT plan and proof accepted only by this owning account workflow.
 */
export type InitiateUserRegistrationResult = {
    /**
     * Avatar workflows permit only a single PUT.
     */
    readonly mode: 'single';

    /**
     * The sole signed request, including required headers and its actual deadline.
     */
    readonly request: StorageSignedRequest;

    /**
     * Form-bound proof used at finalization; it cannot authorize URL renewal.
     */
    readonly uploadToken: string;
};
