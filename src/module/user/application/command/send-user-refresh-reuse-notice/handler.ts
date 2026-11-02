/**
 * @file handler.ts
 * @description Sends refresh-token reuse notices to user account owners.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { EmailPayload } from 'src/core/email';
import {
    EMAIL_DELIVERY_PAYLOAD_CONFLICT_MESSAGE,
    TOKEN_EMAILER_PORT,
    escapeHtml,
    type IEmailerPort,
} from 'src/core/email';
import { SendUserRefreshReuseNoticeCommand } from 'src/module/user/application/command/send-user-refresh-reuse-notice/command';
import { ExceptionKind, TerminalJobException, isExceptionOfKind } from 'src/shared/exception';

/**
 * Sends the notice to the immutable event-time address regardless of later account deletion.
 */
@CommandHandler(SendUserRefreshReuseNoticeCommand)
export class SendUserRefreshReuseNoticeCommandHandler implements ICommandHandler<
    SendUserRefreshReuseNoticeCommand,
    void
> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param emailerPort The port used to send the security notice
     */
    constructor(@Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort) {}

    /**
     * Sends the committed security notice to its captured recipient.
     *
     * @param command The command payload
     */
    async execute(command: SendUserRefreshReuseNoticeCommand) {
        try {
            await this.emailerPort.sendEmail(this.buildSecurityEmail(command.recipientEmail, command.recipientName), {
                queueName: command.queueName,
                deliveryId: command.deliveryId,
            });
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.RESOURCE_CONFLICT)) {
                throw new TerminalJobException(EMAIL_DELIVERY_PAYLOAD_CONFLICT_MESSAGE, { cause: error });
            }

            throw error;
        }
    }

    /**
     * Builds the refresh-token reuse security notice.
     *
     * @param to The recipient's email address
     * @param name Display name captured when the notice was created
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
