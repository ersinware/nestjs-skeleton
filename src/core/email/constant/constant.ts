/**
 * @file email.constant.ts
 * @description Dependency injection tokens and constants for the email module.
 */

/**
 * The name of the BullMQ queue handling email operations.
 */
export const QUEUE_EMAIL = 'QUEUE_EMAIL';

/**
 * The job name representing the send email job.
 */
export const JOB_SEND_EMAIL = 'JOB_SEND_EMAIL';
