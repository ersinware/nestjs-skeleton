/**
 * @file command.ts
 * @description Requests a security notice after refresh-token reuse revokes a user's sessions.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Requests a refresh-token reuse notice for a user.
 */
export class SendUserRefreshReuseNoticeCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user to notify
     */
    constructor(readonly id: string) {
        super();
    }
}
