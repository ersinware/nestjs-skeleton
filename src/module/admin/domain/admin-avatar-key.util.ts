/**
 * @file admin-avatar-key.util.ts
 * @description Owns pending and permanent admin avatar object key formats.
 */

/**
 * Selects the pending key reserved for an activation or profile avatar identity.
 *
 * @param adminId Account identity
 * @param avatarId Invitation identity during activation, or profile avatar identity
 * @returns Pending avatar object key
 */
export function buildAdminPendingAvatarKey(adminId: string, avatarId: string): string {
    return `pending/avatar/admin/${adminId}/${avatarId}`;
}

/**
 * Selects a permanent key unique to one immutable avatar version.
 *
 * @param adminId Account identity
 * @param avatarId Stable avatar identity retained across delivery retries
 * @returns Permanent avatar object key
 */
export function buildAdminPermanentAvatarKey(adminId: string, avatarId: string): string {
    return `avatar/admin/${adminId}/${avatarId}`;
}
