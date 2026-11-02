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
     * @param deliveryId The notice delivery identity retained across retries
     * @param queueName The queue that owns this delivery
     * @param recipientEmail Immutable address captured by the producer
     * @param recipientName Immutable display name captured by the producer
     */
    constructor(
        readonly deliveryId: string,
        readonly queueName: string,
        readonly recipientEmail: string,
        readonly recipientName: string,
    ) {
        super();
    }
}
