/**
 * @file permission.enum.ts
 * @description The closed catalog of every permission a principal may hold.
 */

/**
 * Every permission the system checks, named `<context>:<resource>:<action>`. The catalog is static
 * by nature: a permission exists because code enforces it, so adding one is a code change; who
 * HOLDS a permission is the dynamic half, stored per principal and carried in the access token.
 * Values are stored verbatim, so a member's value must never change once granted.
 */
export enum Permission {
    /**
     * The root tier: the single account that appoints and dismisses permission managers and that
     * nobody may administer. A tier marker rather than a `<resource>:<action>`, and never granted
     * over the API — exactly one admin row holds it, enforced by a partial unique index.
     */
    ADMIN_ROOT = 'admin:root',

    /**
     * Read admin accounts: the listing and the single lookup.
     */
    ADMIN_ACCOUNT_READ = 'admin:account:read',

    /**
     * Create an admin account pending activation, and re-issue its invitation.
     */
    ADMIN_ACCOUNT_INVITE = 'admin:account:invite',

    /**
     * Ban and unban admin accounts.
     */
    ADMIN_ACCOUNT_BAN = 'admin:account:ban',

    /**
     * Soft-delete admin accounts.
     */
    ADMIN_ACCOUNT_DELETE = 'admin:account:delete',

    /**
     * The manager tier: read the admin permission catalog and give or take ordinary permissions. Appointed by root only.
     */
    ADMIN_PERMISSION_MANAGE = 'admin:permission:manage',

    /**
     * Read the audit trail.
     */
    AUDIT_TRAIL_RECORD_READ = 'audit-trail:record:read',

    /**
     * Read the per-indicator health detail, which names the dependency topology.
     */
    HEALTH_DETAIL_READ = 'health:detail:read',

    /**
     * Read dead-letter job metadata and redrive status.
     */
    JOB_DEAD_LETTER_READ = 'job-queue:dead-letter:read',

    /**
     * Start a shared dead-letter redrive operation.
     */
    JOB_DEAD_LETTER_REDRIVE = 'job-queue:dead-letter:redrive',

    /**
     * Discard exact dead-letter job identifiers.
     */
    JOB_DEAD_LETTER_DISCARD = 'job-queue:dead-letter:discard',

    /**
     * Read user accounts: the listing and the single lookup.
     */
    USER_ACCOUNT_READ = 'user:account:read',

    /**
     * Ban and unban user accounts.
     */
    USER_ACCOUNT_BAN = 'user:account:ban',

    /**
     * Read the user permission catalog and change what users hold.
     */
    USER_PERMISSION_MANAGE = 'user:permission:manage',
}
