/**
 * @file handler.ts
 * @description Sends a completed user email-change notice using immutable recipient evidence.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
    EMAIL_DELIVERY_PAYLOAD_CONFLICT_MESSAGE,
    TOKEN_EMAILER_PORT,
    escapeHtml,
    type IEmailerPort,
} from 'src/core/email';
import { SendUserEmailChangeNotificationCommand } from 'src/module/user/application/command/send-user-email-change-notification/command';
import {
    TOKEN_GET_USER_EMAIL_CHANGE_NOTIFICATION_RECIPIENT_PORT,
    type IGetUserEmailChangeNotificationRecipientPort,
} from 'src/module/user/application/query/get-user-email-change-notification-recipient/port';
import { ExceptionKind, TerminalJobException, isExceptionOfKind } from 'src/shared/exception';

/**
 * Sends a security notice without consulting the account's current email address.
 */
@CommandHandler(SendUserEmailChangeNotificationCommand)
export class SendUserEmailChangeNotificationCommandHandler implements ICommandHandler<
    SendUserEmailChangeNotificationCommand,
    void
> {
    /**
     * Initializes delivery dependencies.
     *
     * @param recipientPort Reads the historical recipient on the primary
     * @param emailerPort Sends the notice to the email provider
     */
    constructor(
        @Inject(TOKEN_GET_USER_EMAIL_CHANGE_NOTIFICATION_RECIPIENT_PORT)
        private readonly recipientPort: IGetUserEmailChangeNotificationRecipientPort,
        @Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort,
    ) {}

    /**
     * Sends the stored notice, skipping only missing delivery records.
     *
     * @param command Notification identity from the durable job
     */
    async execute(command: SendUserEmailChangeNotificationCommand) {
        const recipient = await this.recipientPort.getEmailChangeNotificationRecipient(command.id);

        if (!recipient) {
            return;
        }

        try {
            await this.emailerPort.sendEmail(
                {
                    to: recipient.previousEmail,
                    subject: 'Your account email address was changed',
                    body:
                        `<p>The email address for your account was changed on ${escapeHtml(recipient.createdAt.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }))} UTC.</p>` +
                        `<p>If you did not make this change, contact support immediately.</p>`,
                },
                { queueName: command.queueName, deliveryId: command.id },
            );
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.RESOURCE_CONFLICT)) {
                throw new TerminalJobException(EMAIL_DELIVERY_PAYLOAD_CONFLICT_MESSAGE, { cause: error });
            }

            throw error;
        }
    }
}
