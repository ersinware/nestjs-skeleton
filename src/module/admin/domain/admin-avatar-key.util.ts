/**
 * @file admin-avatar-key.util.ts
 * @description Owns pending and permanent admin avatar object key formats.
 */

/**
 * Selects the pending key reserved for an invitation identity.
 *
 * @param adminId Invited account identity
 * @param inviteId Persisted invitation identity
 * @returns Pending avatar object key
 */
export function buildAdminPendingAvatarKey(adminId: string, inviteId: string): string {
    return `pending/avatar/admin/${adminId}/${inviteId}`;
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
