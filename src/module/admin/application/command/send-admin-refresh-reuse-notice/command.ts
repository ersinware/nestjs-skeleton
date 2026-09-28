/**
 * @file command.ts
 * @description Requests a security notice after refresh-token reuse revokes an admin's sessions.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Requests a refresh-token reuse notice for an admin.
 */
export class SendAdminRefreshReuseNoticeCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin to notify
     * @param deliveryId The notice delivery identity retained across retries
     * @param queueName The queue that owns this delivery
     */
    constructor(
        readonly id: string,
        readonly deliveryId: string,
        readonly queueName: string,
    ) {
        super();
    }
}
