/**
 * @file user-registration.ts
 * @description Owns user registration upload lifetimes and form binding to upload proofs.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { UserUploadPurpose } from 'src/module/user/domain/user-upload-purpose.enum';
import type { AvatarUploadDescriptor } from 'src/shared/domain/avatar';
import { InvalidInputException } from 'src/shared/exception';

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
 * Binds credentials with a server-held key so the public proof cannot expose a password digest.
 * The fixed field order and purpose prefix separate this binding from JWT signatures.
 *
 * @param form Validated and normalized registration form
 * @param uploadSecret Server-held upload secret
 * @returns Opaque keyed form binding
 */
export function createUserRegistrationFormHash(form: UserRegistrationForm, uploadSecret: string): string {
    return createHmac('sha256', uploadSecret)
        .update(
            JSON.stringify([
                UserUploadPurpose.REGISTRATION,
                form.email,
                form.name,
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
 * @param form Validated and normalized final registration form
 * @param secret Server-held upload secret
 * @param expectedFormHash Binding from the verified upload proof
 * @throws {InvalidInputException} When the form binding does not match
 */
export function assertUserRegistrationFormHashMatches(
    form: UserRegistrationForm,
    secret: string,
    expectedFormHash: string,
) {
    const actualFormHashBuffer = Buffer.from(createUserRegistrationFormHash(form, secret)),
        expectedFormHashBuffer = Buffer.from(expectedFormHash);

    if (
        actualFormHashBuffer.length !== expectedFormHashBuffer.length ||
        !timingSafeEqual(actualFormHashBuffer, expectedFormHashBuffer)
    ) {
        throw new InvalidInputException();
    }
}
