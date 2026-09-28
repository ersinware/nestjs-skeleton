/**
 * @file handler.ts
 * @description Sends refresh-token reuse notices to user account owners.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { EmailPayload } from 'src/core/email';
import { TOKEN_EMAILER_PORT, escapeHtml, type IEmailerPort } from 'src/core/email';
import { SendUserRefreshReuseNoticeCommand } from 'src/module/user/application/command/send-user-refresh-reuse-notice/command';
import {
    TOKEN_GET_USER_NOTICE_RECIPIENT_PORT,
    type IGetUserNoticeRecipientPort,
} from 'src/module/user/application/query/get-user-notice-recipient/port';

/**
 * Sends the notice using the user's current contact details.
 */
@CommandHandler(SendUserRefreshReuseNoticeCommand)
export class SendUserRefreshReuseNoticeCommandHandler implements ICommandHandler<
    SendUserRefreshReuseNoticeCommand,
    void
> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param noticeRecipientPort The port used to read the user's current contact details
     * @param emailerPort The port used to send the security notice
     */
    constructor(
        @Inject(TOKEN_GET_USER_NOTICE_RECIPIENT_PORT)
        private readonly noticeRecipientPort: IGetUserNoticeRecipientPort,
        @Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort,
    ) {}

    /**
     * Sends the notice unless the user was deleted after the job was created.
     *
     * @param command The command payload
     */
    async execute(command: SendUserRefreshReuseNoticeCommand) {
        const recipient = await this.noticeRecipientPort.getNoticeRecipient(command.id);

        if (!recipient) {
            return;
        }

        await this.emailerPort.sendEmail(this.buildSecurityEmail(recipient.email, recipient.name), {
            queueName: command.queueName,
            deliveryId: command.deliveryId,
        });
    }

    /**
     * Builds the refresh-token reuse security notice.
     *
     * @param to The recipient's email address
     * @param name The recipient's display name
     * @returns The email payload to send
     */
    private buildSecurityEmail(to: string, name: string): EmailPayload {
        return {
            to,
            subject: 'Security alert: you were signed out of all devices',
            body:
                `<p>Hi ${escapeHtml(name)},</p>` +
                `<p>We noticed a sign-in token for your account was reused after it had already been rotated, ` +
                `which can indicate the token was stolen. As a precaution we signed you out of every device.</p>` +
                `<p>You can sign back in with your usual password. For your security we strongly recommend ` +
                `changing your password as soon as you sign in.</p>` +
                `<p>If you did not expect this, please change your password immediately.</p>`,
        };
    }
}
