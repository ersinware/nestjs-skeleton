/**
 * @file avatar-upload.ts
 * @description Shared file contract for account-owned avatar uploads.
 */

import { InvalidInputException } from 'src/shared/exception';

/**
 * Maximum avatar size accepted by account workflows, in bytes.
 */
export const AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Declared media types accepted for account avatars; content inspection is separate.
 */
export const AVATAR_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * An allowed declared avatar media type.
 */
export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];

/**
 * File details bound to the account form at initiation and submitted again at finalization.
 */
export type AvatarUploadDescriptor = {
    /**
     * Expected non-empty file size in bytes.
     */
    readonly sizeBytes: number;

    /**
     * Declared media type, checked against stored metadata at finalization.
     */
    readonly contentType: AvatarContentType;
};

/**
 * Rejects uploaded metadata that differs from the descriptor bound to the account form.
 *
 * @param actual.sizeBytes Uploaded object size in bytes.
 * @param actual.contentType Uploaded object media type; absence fails the descriptor comparison.
 * @param expected Descriptor accepted when the upload was prepared
 * @throws {InvalidInputException} When the size or media type differs, including a missing media type
 */
export function assertAvatarUploadMatchesDescriptor(
    actual: {
        readonly sizeBytes: number;
        readonly contentType?: string;
    },
    expected: AvatarUploadDescriptor,
) {
    if (actual.sizeBytes !== expected.sizeBytes || actual.contentType !== expected.contentType) {
        throw new InvalidInputException();
    }
}
