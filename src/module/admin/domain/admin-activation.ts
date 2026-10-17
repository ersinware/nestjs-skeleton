/**
 * @file admin-activation.ts
 * @description Owns admin activation upload lifetimes and form binding to upload proofs.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { AdminUploadPurpose } from 'src/module/admin/domain/admin-upload-purpose.enum';
import type { AvatarUploadDescriptor } from 'src/shared/domain/avatar';
import { InvalidInputException } from 'src/shared/exception';

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
 * Binds credentials with a server-held key so the public proof cannot expose a password digest.
 * The fixed field order and purpose prefix separate this binding from JWT signatures.
 *
 * @param form Validated and normalized activation form
 * @param uploadSecret Server-held upload secret
 * @returns Opaque keyed form binding
 */
export function createAdminActivationFormHash(form: AdminActivationForm, uploadSecret: string): string {
    return createHmac('sha256', uploadSecret)
        .update(
            JSON.stringify([
                AdminUploadPurpose.ACTIVATION,
                form.id,
                form.inviteId,
                form.password,
                form.avatar.sizeBytes,
                form.avatar.contentType,
            ]),
        )
        .digest('hex');
}

/**
 * Rejects a final form that differs from the signature-verified binding.
 *
 * @param form Validated and normalized final activation form
 * @param secret Server-held upload secret
 * @param expectedFormHash Binding from the verified upload proof
 * @throws {InvalidInputException} When the form binding does not match
 */
export function assertAdminActivationFormHashMatches(
    form: AdminActivationForm,
    secret: string,
    expectedFormHash: string,
) {
    const actualFormHashBuffer = Buffer.from(createAdminActivationFormHash(form, secret)),
        expectedFormHashBuffer = Buffer.from(expectedFormHash);

    if (
        actualFormHashBuffer.length !== expectedFormHashBuffer.length ||
        !timingSafeEqual(actualFormHashBuffer, expectedFormHashBuffer)
    ) {
        throw new InvalidInputException();
    }
}
