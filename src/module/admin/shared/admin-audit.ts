/**
 * @file admin-audit.ts
 * @description Audit actions owned by the Admin workflows.
 */

import { defineAuditAction } from 'src/shared/domain/audit';

/**
 * Audit actions owned by the Admin workflows.
 */
export const AdminAuditAction = {
    /**
     * An admin account was created, pending activation by its owner.
     */
    ADMIN_CREATED: defineAuditAction('ADMIN_CREATED'),

    /**
     * A fresh invitation was issued for a pending admin account.
     */
    ADMIN_INVITED: defineAuditAction('ADMIN_INVITED'),

    /**
     * A pending admin account was activated by its owner setting the first password.
     */
    ADMIN_ACTIVATED: defineAuditAction('ADMIN_ACTIVATED'),

    /**
     * The admin avatar moved from its pending key to an immutable permanent key.
     */
    ADMIN_AVATAR_FINALIZED: defineAuditAction('ADMIN_AVATAR_FINALIZED'),

    /**
     * A change to an admin's profile name or avatar.
     */
    ADMIN_UPDATED: defineAuditAction('ADMIN_UPDATED'),

    /**
     * An admin account was banned and its sessions revoked.
     */
    ADMIN_BANNED: defineAuditAction('ADMIN_BANNED'),

    /**
     * A ban on an admin account was lifted.
     */
    ADMIN_UNBANNED: defineAuditAction('ADMIN_UNBANNED'),

    /**
     * An admin account was soft-deleted.
     */
    ADMIN_DELETED: defineAuditAction('ADMIN_DELETED'),

    /**
     * An admin's permission set was changed; `detail` names what was granted and revoked.
     */
    ADMIN_PERMISSIONS_CHANGED: defineAuditAction('ADMIN_PERMISSIONS_CHANGED'),

    /**
     * An owner consumer committed revocation of an admin's sessions.
     */
    ADMIN_SESSIONS_REVOKED: defineAuditAction('ADMIN_SESSIONS_REVOKED'),

    /**
     * Rejected admin activation; the record carries the reason the client never sees.
     */
    ADMIN_ACTIVATION_FAILED: defineAuditAction('ADMIN_ACTIVATION_FAILED'),

    /**
     * A banned admin attempted to prepare a profile avatar change.
     */
    ADMIN_AVATAR_CHANGE_FAILED: defineAuditAction('ADMIN_AVATAR_CHANGE_FAILED'),

    /**
     * A profile update was refused for a banned admin or a proof ownership mismatch.
     */
    ADMIN_UPDATE_FAILED: defineAuditAction('ADMIN_UPDATE_FAILED'),

    /**
     * A banned admin could not receive a replacement invitation.
     */
    ADMIN_INVITATION_FAILED: defineAuditAction('ADMIN_INVITATION_FAILED'),

    /**
     * An administrative mutation was refused by admin hierarchy or self-target restrictions.
     */
    ADMIN_ADMINISTRATION_DENIED: defineAuditAction('ADMIN_ADMINISTRATION_DENIED'),
} as const;
