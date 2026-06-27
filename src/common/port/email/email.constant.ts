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
export const QUEUE_EMAIL = 'QUEUE_EMAIL';

/**
 * The job name representing the welcome email sent to new admin accounts.
 */
export const JOB_WELCOME_ADMIN = 'JOB_WELCOME_ADMIN';

/**
 * Dependency injection token representing the mailer service contract interface.
 */
export const TOKEN_MAILER_SERVICE = Symbol('TOKEN_MAILER_SERVICE');
