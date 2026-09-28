/**
 * @file handler.ts
 * @description Reproduces a pending request's JWT and sends it to its stored target address.
 */

import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ENV } from 'src/core/config';
import { TOKEN_EMAILER_PORT, escapeHtml, type EmailPayload, type IEmailerPort } from 'src/core/email';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { SendUserEmailConfirmationCommand } from 'src/module/user/application/command/send-user-email-confirmation/command';
import {
    TOKEN_GET_USER_EMAIL_CONFIRMATION_RECIPIENT_PORT,
    type IGetUserEmailConfirmationRecipientPort,
} from 'src/module/user/application/query/get-user-email-confirmation-recipient/port';
import { PrincipalType } from 'src/shared/domain/principal';

/**
 * Skips stale deliveries; confirmation must recheck state because delivery can race with replacement.
 */
@CommandHandler(SendUserEmailConfirmationCommand)
export class SendUserEmailConfirmationCommandHandler implements ICommandHandler<
    SendUserEmailConfirmationCommand,
    void
> {
    /**
     * Initializes delivery dependencies.
     *
     * @param recipientPort Reads eligible request metadata from the primary
     * @param tokenPort Signs the persisted claims
     * @param emailerPort Sends the confirmation email
     * @param configService Provides the trusted frontend confirmation URL
     */
    constructor(
        @Inject(TOKEN_GET_USER_EMAIL_CONFIRMATION_RECIPIENT_PORT)
        private readonly recipientPort: IGetUserEmailConfirmationRecipientPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort,
        private readonly configService: ConfigService,
    ) {}

    /**
     * Sends only the request identified by this delivery job.
     *
     * @param command The account and original request identifiers
     */
    async execute(command: SendUserEmailConfirmationCommand) {
        const recipient = await this.recipientPort.getEmailConfirmationRecipient(command.id, command.deliveryId);

        if (!recipient) {
            return;
        }

        await this.emailerPort.sendEmail(
            this.buildConfirmationEmail(
                recipient.pendingEmail,
                recipient.name,
                await this.tokenPort.generateEmailConfirmationToken({
                    sub: command.id,
                    principalType: PrincipalType.USER,
                    jti: recipient.pendingEmailRequestId,
                    exp: Math.floor(recipient.pendingEmailExpiresAt.getTime() / 1000),
                    emailRevocationVersion: recipient.pendingEmailRevocationVersion,
                }),
            ),
            { queueName: command.queueName, deliveryId: command.deliveryId },
        );
    }

    /**
     * Encodes the token as a URL parameter before escaping the link for HTML.
     *
     * @param to Pending address from the persisted request
     * @param name Display name used in the greeting
     * @param token JWT reproduced from fixed request metadata
     * @returns Confirmation email with the trusted frontend link
     */
    private buildConfirmationEmail(to: string, name: string, token: string): EmailPayload {
        const url = new URL(this.configService.getOrThrow<string>(ENV.USER_EMAIL_CONFIRM_URL));
        url.searchParams.set('token', token);

        return {
            to,
            subject: 'Confirm your new email address',
            body:
                `<p>Hi ${escapeHtml(name)},</p>` +
                `<p>A change to this email address was requested for your account. ` +
                `Use the link below to review and confirm the change:</p>` +
                `<p><a href="${escapeHtml(url.toString())}">Confirm your email address</a></p>` +
                `<p>Sign in with your current email address if needed. ` +
                `This link expires shortly. If you did not request this change, ignore this email.</p>`,
        };
    }
}
