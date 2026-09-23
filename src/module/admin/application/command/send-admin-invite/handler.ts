/**
 * @file handler.ts
 * @description Handles SendAdminInviteCommand. Reproduces the persisted invitation JWT and emails the activation link to the pending admin.
 */

import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ENV } from 'src/core/config';
import type { EmailPayload } from 'src/core/email';
import { TOKEN_EMAILER_PORT, escapeHtml, type IEmailerPort } from 'src/core/email';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { SendAdminInviteCommand } from 'src/module/admin/application/command/send-admin-invite/command';
import {
    TOKEN_GET_ADMIN_INVITE_RECIPIENT_PORT,
    type IGetAdminInviteRecipientPort,
} from 'src/module/admin/application/query/get-admin-invite-recipient/port';

/**
 * Emails the activation invitation for a pending admin. Re-reads the account and silently skips one
 * that is no longer eligible. Account changes after the read can still race with email delivery;
 * activation always checks authoritative state again.
 */
@CommandHandler(SendAdminInviteCommand)
export class SendAdminInviteCommandHandler implements ICommandHandler<SendAdminInviteCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param inviteRecipientPort The port used to read the admin's current invitation details
     * @param tokenPort The port used to sign the fixed invitation claims
     * @param emailerPort The port used to send the invitation email
     * @param configService Provides the activation page's base URL
     */
    constructor(
        @Inject(TOKEN_GET_ADMIN_INVITE_RECIPIENT_PORT)
        private readonly inviteRecipientPort: IGetAdminInviteRecipientPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort,
        private readonly configService: ConfigService,
    ) {}

    /**
     * Executes the send admin invite command.
     *
     * @param command The command payload
     */
    async execute(command: SendAdminInviteCommand) {
        const recipient = await this.inviteRecipientPort.getInviteRecipient(command.id);

        // A retry belongs to its original invitation, never a later replacement.
        if (
            !recipient ||
            recipient.inviteId === null ||
            recipient.inviteIssuedAt === null ||
            recipient.inviteExpiresAt === null ||
            recipient.inviteRevocationVersion === null ||
            recipient.inviteId !== command.deliveryId ||
            recipient.inviteExpiresAt.getTime() <= Date.now() ||
            recipient.inviteRevocationVersion !== recipient.revocationVersion
        ) {
            return;
        }

        await this.emailerPort.sendEmail(
            this.buildInviteEmail(
                recipient.email,
                recipient.name,
                await this.tokenPort.generateInviteToken({
                    sub: command.id,
                    jti: recipient.inviteId,
                    iat: Math.floor(recipient.inviteIssuedAt.getTime() / 1000),
                    exp: Math.floor(recipient.inviteExpiresAt.getTime() / 1000),
                    inviteRevocationVersion: recipient.inviteRevocationVersion,
                }),
            ),
        );
    }

    /**
     * Builds the invitation email carrying the activation link.
     *
     * @param to The recipient's email address
     * @param name The recipient's display name
     * @param token The JWT reproduced from the persisted invitation
     * @returns The email payload to send
     */
    private buildInviteEmail(to: string, name: string, token: string): EmailPayload {
        return {
            to,
            subject: 'You have been invited as an administrator',
            body:
                `<p>Hi ${escapeHtml(name)},</p>` +
                `<p>An administrator account has been created for this email address. ` +
                `To activate it, choose your password using the link below:</p>` +
                `<p><a href="${escapeHtml(`${this.configService.getOrThrow<string>(ENV.ADMIN_INVITE_URL)}?token=${encodeURIComponent(token)}`)}">Activate your account</a></p>` +
                `<p>The link expires after a limited time. If it has expired, ask the administrator ` +
                `who invited you to send a new one. If you did not expect this invitation, you can ` +
                `safely ignore this email.</p>`,
        };
    }
}
