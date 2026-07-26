/**
 * @file command.ts
 * @description Defines the SendAdminWelcomeEmailCommand, dispatched after an admin is created so the
 * module can send the welcome email as a side effect.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to send the welcome email for a newly created admin. Re-reads the admin's email and name
 * from the database so the outcome does not depend on stale event payload.
 */
export class SendAdminWelcomeEmailCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the newly created admin
     */
    constructor(readonly id: string) {
        super();
    }
}
