/**
 * @file email.type.ts
 * @description TypeScript type definitions for email queue job payloads.
 */

/**
 * Represents the data payload structure required for the welcome-admin email job.
 */
export interface WelcomeAdminJobData {
    /**
     * The target recipient email address.
     */
    email: string;

    /**
     * The admin's full name.
     */
    name: string;

    /**
     * The cleartext generated temporary password.
     */
    password: string;
}
