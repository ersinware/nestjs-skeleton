/**
 * @file user-avatar-key.util.ts
 * @description Owns pending and permanent user avatar object key formats.
 */

/**
 * Selects the pending key for an immutable avatar version; registration uses the account identity.
 *
 * @param userId Account identity
 * @param avatarId Avatar version identity; registration explicitly supplies the account identity
 * @returns Pending avatar object key
 */
export function buildUserPendingAvatarKey(userId: string, avatarId: string): string {
    return `pending/avatar/user/${userId}/${avatarId}`;
}

/**
 * Selects a permanent key unique to one immutable avatar version.
 *
 * @param userId Account identity
 * @param avatarId Stable avatar identity retained across delivery retries
 * @returns Permanent avatar object key
 */
export function buildUserPermanentAvatarKey(userId: string, avatarId: string): string {
    return `avatar/user/${userId}/${avatarId}`;
}
