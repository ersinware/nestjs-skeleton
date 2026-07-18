/**
 * @file handler.ts
 * @description Handles RevokeAdminSessionsCommand. On detected refresh-token reuse it bumps the admin's
 * session version (revoking every token), sends a security-notice email, then applies the version to
 * Redis on a best-effort basis.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { EmailPayload } from 'src/core/email';
import { TOKEN_EMAILER_PORT, type IEmailerPort } from 'src/core/email';
import { LogPayload, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { RevokeAdminSessionsCommand } from 'src/module/admin/application/command/revoke-admin-sessions/command';

/**
 * Revokes all of an admin's sessions after refresh-token reuse and emails the account owner a security notice.
 */
@CommandHandler(RevokeAdminSessionsCommand)
export class RevokeAdminSessionsCommandHandler implements ICommandHandler<RevokeAdminSessionsCommand> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param adminWriterPort The port used to load and save the admin aggregate
     * @param emailerPort The port used to send the security-notice email
     * @param sessionPort The port used to push the session version to Redis
     * @param loggerPort The port used to record best-effort sync-write failures
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
    ) {}

    /**
     * Executes the revoke-admin-sessions command.
     *
     * @param command The command payload
     */
    async execute(command: RevokeAdminSessionsCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        // The account may have been removed between reuse detection and this handler; nothing to revoke.
        if (!admin) {
            return;
        }

        admin.revokeSessions();

        await this.adminWriterPort.save(admin);
        await this.emailerPort.sendEmail(this.buildSecurityEmail(admin.email, admin.name));

        try {
            await this.sessionPort.setVersion(command.id, admin.version);
        } catch (error) {
            this.loggerPort.error(
                new LogPayload({ class: RevokeAdminSessionsCommandHandler.name, method: this.execute.name, error }),
            );
        }
    }

    /**
     * Builds the security-notice email sent after sessions are revoked, advising (not forcing) a password change.
     *
     * @param to The recipient's email address
     * @param name The recipient's display name, used to personalize the message
     * @returns The email payload to send
     */
    private buildSecurityEmail(to: string, name: string): EmailPayload {
        return {
            to,
            subject: 'Security alert: you were signed out of all devices',
            body:
                `<p>Hi ${name},</p>` +
                `<p>We noticed a sign-in token for your account was reused after it had already been rotated, ` +
                `which can indicate the token was stolen. As a precaution we signed you out of every device.</p>` +
                `<p>You can sign back in with your usual password. For your security we strongly recommend ` +
                `changing your password as soon as you sign in.</p>` +
                `<p>If you did not expect this, please change your password immediately.</p>`,
        };
    }
}
