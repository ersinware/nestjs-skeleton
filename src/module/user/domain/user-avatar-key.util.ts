/**
 * @file user-avatar-key.util.ts
 * @description Owns pending and permanent user avatar object key formats.
 */

/**
 * Selects the pending key reserved for a registration identity.
 *
 * @param userId Handler-generated registration identity
 * @returns Pending avatar object key
 */
export function buildUserPendingAvatarKey(userId: string): string {
    return `pending/avatar/user/${userId}`;
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
