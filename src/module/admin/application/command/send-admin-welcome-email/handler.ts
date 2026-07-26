/**
 * @file handler.ts
 * @description Handles SendAdminWelcomeEmailCommand by reading the admin's email and name and sending
 * the welcome email through the emailer port.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_EMAILER_PORT, type IEmailerPort } from 'src/core/email';
import { SendAdminWelcomeEmailCommand } from 'src/module/admin/application/command/send-admin-welcome-email/command';
import {
    TOKEN_GET_ADMIN_EMAIL_AND_NAME_PORT,
    type IGetAdminEmailAndNamePort,
} from 'src/module/admin/application/query/get-admin-email-and-name/port';

/**
 * Sends the welcome email for a newly created admin. Reads the recipient from the database rather than
 * the event payload, so a redelivery re-reads current truth. Reads run on the handler's own port, never
 * the QueryBus.
 */
@CommandHandler(SendAdminWelcomeEmailCommand)
export class SendAdminWelcomeEmailCommandHandler implements ICommandHandler<SendAdminWelcomeEmailCommand> {
    /**
     * Initializes the handler with the email-and-name and emailer ports.
     *
     * @param emailAndNamePort Query port that reads the admin's email and name for the welcome email.
     * @param emailerPort Port that sends the email through the provider.
     */
    constructor(
        @Inject(TOKEN_GET_ADMIN_EMAIL_AND_NAME_PORT)
        private readonly emailAndNamePort: IGetAdminEmailAndNamePort,
        @Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort,
    ) {}

    /**
     * Executes the send-admin-welcome-email command.
     *
     * @param command The command payload carrying the admin id.
     */
    async execute(command: SendAdminWelcomeEmailCommand) {
        const admin = await this.emailAndNamePort.getAdminEmailAndName(command.id);

        // The admin was just created and is never hard-deleted, so a missing projection is not
        // expected; skip silently rather than dereference a null identity.
        if (!admin) {
            return;
        }

        await this.emailerPort.sendEmail({
            to: admin.email,
            subject: 'Welcome',
            body: 'TODO',
        });
    }
}
