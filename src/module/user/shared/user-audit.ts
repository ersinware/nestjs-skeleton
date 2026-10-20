/**
 * @file user-audit.ts
 * @description Audit actions owned by the User workflows.
 */

import { defineAuditAction } from 'src/shared/domain/audit';

/**
 * Audit actions owned by the User workflows.
 */
export const UserAuditAction = {
    /**
     * A pending user and its first activation delivery request were committed; public route, so unattributed.
     */
    USER_REGISTERED: defineAuditAction('USER_REGISTERED'),

    /**
     * A user's attached pending avatar was transitioned to its permanent object key.
     */
    USER_AVATAR_FINALIZED: defineAuditAction('USER_AVATAR_FINALIZED'),

    /**
     * A pending user's activation delivery request was committed; delivery may follow.
     */
    USER_ACTIVATION_REQUESTED: defineAuditAction('USER_ACTIVATION_REQUESTED'),

    /**
     * A pending user account was activated after email and password proof.
     */
    USER_ACTIVATED: defineAuditAction('USER_ACTIVATED'),

    /**
     * A change to the user's profile name or avatar.
     */
    USER_UPDATED: defineAuditAction('USER_UPDATED'),

    /**
     * A user account was banned and its sessions revoked.
     */
    USER_BANNED: defineAuditAction('USER_BANNED'),

    /**
     * A ban on a user account was lifted.
     */
    USER_UNBANNED: defineAuditAction('USER_UNBANNED'),

    /**
     * A user account was soft-deleted.
     */
    USER_DELETED: defineAuditAction('USER_DELETED'),

    /**
     * A user's permission set was changed; `detail` names what was granted and revoked.
     */
    USER_PERMISSIONS_CHANGED: defineAuditAction('USER_PERMISSIONS_CHANGED'),

    /**
     * An owner consumer committed revocation of a user's sessions.
     */
    USER_SESSIONS_REVOKED: defineAuditAction('USER_SESSIONS_REVOKED'),

    /**
     * Rejected user activation; the record carries the reason the client never sees.
     */
    USER_ACTIVATION_FAILED: defineAuditAction('USER_ACTIVATION_FAILED'),

    /**
     * A banned user requested another activation email without revealing the refusal publicly.
     */
    USER_ACTIVATION_RESEND_FAILED: defineAuditAction('USER_ACTIVATION_RESEND_FAILED'),

    /**
     * A profile update was refused for a banned user or a proof ownership mismatch.
     */
    USER_UPDATE_FAILED: defineAuditAction('USER_UPDATE_FAILED'),

    /**
     * A banned user attempted to prepare a profile avatar upload.
     */
    USER_AVATAR_CHANGE_FAILED: defineAuditAction('USER_AVATAR_CHANGE_FAILED'),
} as const;
