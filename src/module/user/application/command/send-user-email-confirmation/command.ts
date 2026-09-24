/**
 * @file command.ts
 * @description Command that emails a confirmation link to a user account's pending address.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Delivers one persisted email confirmation request.
 */
export class SendUserEmailConfirmationCommand extends Command<void> {
    /**
     * Initializes the command with its payload.
     *
     * @param id The unique identifier of the target user
     * @param deliveryId The email request delivery identity retained across retries
     */
    constructor(
        readonly id: string,
        readonly deliveryId: string,
    ) {
        super();
    }
}
