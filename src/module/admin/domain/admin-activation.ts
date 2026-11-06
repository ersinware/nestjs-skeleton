/**
 * @file admin-activation.ts
 * @description Owns admin activation upload lifetimes and form binding to upload proofs.
 */

import type { AvatarUploadDescriptor } from 'src/shared/domain/avatar';

/**
 * Time allowed to upload the initial avatar, in seconds.
 */
export const ADMIN_ACTIVATION_UPLOAD_URL_TTL_SECONDS = 300;

/**
 * Time allowed to complete activation with the uploaded avatar, in seconds.
 */
export const ADMIN_ACTIVATION_UPLOAD_TOKEN_TTL_SECONDS = 600;

/**
 * Normalized activation fields bound to one upload proof.
 */
type AdminActivationForm = {
    /**
     * Account identified by the verified invitation.
     */
    readonly id: string;

    /**
     * Persisted invitation identity.
     */
    readonly inviteId: string;

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
 * Serializes the activation form in a fixed field order for application-owned HMAC binding.
 *
 * @param form Validated and normalized activation form
 * @returns Canonical form text to pass directly to the hashing port; never expose it in proofs
 */
export function canonicalizeAdminActivationForm(form: AdminActivationForm): string {
    return JSON.stringify([form.id, form.inviteId, form.password, form.avatar.sizeBytes, form.avatar.contentType]);
}
