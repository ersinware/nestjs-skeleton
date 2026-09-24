/**
 * @file command.ts
 * @description Command that emails a confirmation link to a admin account's pending address.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Delivers one persisted email confirmation request.
 */
export class SendAdminEmailConfirmationCommand extends Command<void> {
    /**
     * Initializes the command with its payload.
     *
     * @param id The unique identifier of the target admin
     * @param deliveryId The email request delivery identity retained across retries
     */
    constructor(
        readonly id: string,
        readonly deliveryId: string,
    ) {
        super();
    }
}
