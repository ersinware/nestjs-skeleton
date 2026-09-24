/**
 * @file command.ts
 * @description Delivers a completed admin email-change notice to its stored old address.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Sends one immutable old-address notification.
 */
export class SendAdminEmailChangeNotificationCommand extends Command<void> {
    /**
     * Initializes a historical notice delivery.
     *
     * @param id Immutable notification identity
     */
    constructor(readonly id: string) {
        super();
    }
}
