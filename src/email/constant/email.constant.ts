/**
 * @file email.constant.ts
 * @description Dependency injection tokens and constants for the email module.
 */

/**
 * Dependency injection token representing the email service contract interface.
 */
export const TOKEN_EMAIL_SERVICE = Symbol('TOKEN_EMAIL_SERVICE');

/**
 * The name of the BullMQ queue handling email operations.
 */
export const QUEUE_NAME_EMAIL = 'QUEUE_NAME_EMAIL';

/**
 * The job name representing the welcome email sent to new admin accounts.
 */
export const JOB_NAME_WELCOME_ADMIN = 'JOB_NAME_WELCOME_ADMIN';
