/**
 * @file email.service.interface.ts
 * @description Contract for the EmailService.
 */

import type { WelcomeAdminJobData } from './welcome-admin-job-data.interface';

/**
 * Interface representing the operations supported by the EmailService.
 */
export interface IEmailService {
    /**
     * Queues a welcome email to be dispatched asynchronously to a newly created admin.
     *
     * @param data The payload required to send the welcome email
     */
    queueWelcomeAdminEmail(data: WelcomeAdminJobData): Promise<void>;
}
