/**
 * @file email.service.interface.ts
 * @description Interface defining the contract for high-level business email operations.
 */

import type { WelcomeAdminJobData } from '../type/email.type';

export interface IEmailService {
    /**
     * Dispatches a welcome email to a newly created admin with their generated credentials.
     *
     * @param data The job payload containing recipient and credentials.
     * @returns A promise that resolves when the email job is successfully queued.
     */
    sendAdminWelcomeEmail(data: WelcomeAdminJobData): Promise<void>;
}
