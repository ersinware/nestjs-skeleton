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
     */
    constructor(readonly id: string) {
        super();
    }
}
