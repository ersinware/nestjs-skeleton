/**
 * @file avatar-upload.ts
 * @description Shared file contract for account-owned avatar uploads.
 */

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
