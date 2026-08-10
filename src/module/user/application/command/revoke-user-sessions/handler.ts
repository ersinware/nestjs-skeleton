/**
 * @file handler.ts
 * @description Handles RevokeUserSessionsCommand. On detected refresh-token reuse it bumps the user's
 * session version (revoking every token), sends a security-notice email, then applies the version to
 * Redis on a best-effort basis.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { EmailPayload } from 'src/core/email';
import { TOKEN_EMAILER_PORT, type IEmailerPort } from 'src/core/email';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { RevokeUserSessionsCommand } from 'src/module/user/application/command/revoke-user-sessions/command';

/**
 * Revokes all of a user's sessions after refresh-token reuse and emails the account owner a security notice.
 */
@CommandHandler(RevokeUserSessionsCommand)
export class RevokeUserSessionsCommandHandler implements ICommandHandler<RevokeUserSessionsCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and save the user aggregate
     * @param emailerPort The port used to send the security-notice email
     * @param sessionPort The port used to push the session version to Redis
     * @param auditPort The port used to record the revocation for the audit trail
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the revoke-user-sessions command.
     *
     * @param command The command payload
     */
    async execute(command: RevokeUserSessionsCommand) {
        const user = await this.userWriterPort.load(command.id);

        // The account may have been hard-removed between reuse detection and this handler; nothing to revoke.
        if (!user) {
            return;
        }

        user.revokeSessions();

        // The save is the security outcome: the bumped version lives in the DB, which is the
        // authority every later refresh is checked against. The audit record follows while the fact
        // is established.
        await this.userWriterPort.save(user);
        this.auditPort.record({ action: AuditAction.USER_SESSIONS_REVOKED, targetId: command.id });

        // Best-effort instant eviction, fire-and-forget: the DB version already denies the next
        // refresh, so Redis being unreachable delays the cut-off rather than defeating it. The catch
        // only stops an unhandled rejection.
        this.sessionPort.setVersion(command.id, user.sessionVersion).catch(() => {});

        await this.emailerPort.sendEmail(this.buildSecurityEmail(user.email, user.name));
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
