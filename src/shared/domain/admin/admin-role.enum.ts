/**
 * @file admin-role.enum.ts
 * @description Enumeration representing administrator roles within the system.
 */

/**
 * Administrator authorization roles.
 */
export enum AdminRole {
    /** Manages user accounts. */
    ADMIN = 'admin',

    /** Additionally manages admin accounts and the operator health view; cannot be banned or deleted. */
    SUPER_ADMIN = 'super_admin',
}
