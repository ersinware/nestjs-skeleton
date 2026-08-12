/**
 * @file handler.ts
 * @description Handles SendAdminInviteCommand. Mints an invite token and emails the activation link to the pending admin.
 */

import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ENV } from 'src/core/config';
import type { EmailPayload } from 'src/core/email';
import { TOKEN_EMAILER_PORT, type IEmailerPort } from 'src/core/email';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { SendAdminInviteCommand } from 'src/module/admin/application/command/send-admin-invite/command';

/**
 * Emails the activation invitation for a pending admin. Re-reads the account and silently skips one
 * that no longer needs an invitation, so event redelivery can never invite a deleted, banned, or
 * active account.
 */
@CommandHandler(SendAdminInviteCommand)
export class SendAdminInviteCommandHandler implements ICommandHandler<SendAdminInviteCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param adminWriterPort The port used to re-read the admin's current state
     * @param tokenPort The port used to mint the invite token
     * @param emailerPort The port used to send the invitation email
     * @param configService Provides the activation page's base URL
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
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
        const admin = await this.adminWriterPort.load(command.id);

        // The account may have been deleted, banned, or activated since the emit; activation rejects
        // all three states, so the invitation would be dead.
        if (!admin || admin.isBanned || admin.password !== null) {
            return;
        }

        await this.emailerPort.sendEmail(
            this.buildInviteEmail(admin.email, admin.name, await this.tokenPort.generateInviteToken(admin.id)),
        );
    }

    /**
     * Builds the invitation email carrying the activation link.
     *
     * @param to The recipient's email address
     * @param name The recipient's display name
     * @param token The freshly minted invite token
     * @returns The email payload to send
     */
    private buildInviteEmail(to: string, name: string, token: string): EmailPayload {
        return {
            to,
            subject: 'You have been invited as an administrator',
            body:
                `<p>Hi ${name},</p>` +
                `<p>An administrator account has been created for this email address. ` +
                `To activate it, choose your password using the link below:</p>` +
                `<p><a href="${this.configService.getOrThrow<string>(ENV.ADMIN_INVITE_URL)}?token=${token}">Activate your account</a></p>` +
                `<p>The link expires after a limited time. If it has expired, ask the administrator ` +
                `who invited you to send a new one. If you did not expect this invitation, you can ` +
                `safely ignore this email.</p>`,
        };
    }
}
