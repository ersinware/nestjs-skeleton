/**
 * @file command.ts
 * @description Delivers a completed user email-change notice to its stored old address.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Sends one immutable old-address notification.
 */
export class SendUserEmailChangeNotificationCommand extends Command<void> {
    /**
     * Initializes a historical notice delivery.
     *
     * @param id Immutable notification identity
     * @param queueName The queue that owns this delivery
     */
    constructor(
        readonly id: string,
        readonly queueName: string,
    ) {
        super();
    }
}
