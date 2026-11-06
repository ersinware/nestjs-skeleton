/**
 * @file user-registration.ts
 * @description Owns user registration upload lifetimes and form binding to upload proofs.
 */

import type { AvatarUploadDescriptor } from 'src/shared/domain/avatar';

/**
 * Time allowed to upload the initial avatar, in seconds.
 */
export const USER_REGISTRATION_UPLOAD_URL_TTL_SECONDS = 300;

/**
 * Time allowed to complete registration with the uploaded avatar, in seconds.
 */
export const USER_REGISTRATION_UPLOAD_TOKEN_TTL_SECONDS = 600;

/**
 * Normalized registration fields bound to one upload proof.
 */
type UserRegistrationForm = {
    /**
     * Normalized account address.
     */
    readonly email: string;

    /**
     * Normalized display name.
     */
    readonly name: string;

    /**
     * Unmodified initial password.
     */
    readonly password: string;

    /**
     * Required file descriptor, including its exact size and type.
     */
    readonly avatar: AvatarUploadDescriptor;
};

/**
 * Serializes the registration form in a fixed field order for application-owned HMAC binding.
 *
 * @param form Validated and normalized registration form
 * @returns Canonical form text to pass directly to the hashing port; never expose it in proofs
 */
export function canonicalizeUserRegistrationForm(form: UserRegistrationForm): string {
    return JSON.stringify([form.email, form.name, form.password, form.avatar.sizeBytes, form.avatar.contentType]);
}
