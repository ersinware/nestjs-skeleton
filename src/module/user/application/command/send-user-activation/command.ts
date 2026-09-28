/**
 * @file command.ts
 * @description Command that emails an activation link to a pending user account.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Delivers one persisted activation request to a pending user.
 */
export class SendUserActivationCommand extends Command<void> {
    /**
     * Initializes the command with its payload.
     *
     * @param id The unique identifier of the pending user
     * @param deliveryId The activation delivery identity retained across retries
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
