/**
 * @file handler.ts
 * @description Handles RevokeAdminSessionsCommand: bumps the admin's session counters and notifies the
 * account owner when the reason calls for it.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { EmailPayload } from 'src/core/email';
import { TOKEN_EMAILER_PORT, type IEmailerPort } from 'src/core/email';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { RevokeAdminSessionsCommand } from 'src/module/admin/application/command/revoke-admin-sessions/command';
import { SessionRevocationReason } from 'src/shared/domain/principal';
import { SystemException } from 'src/shared/exception';

/**
 * Revokes all of an admin's sessions; on refresh-token reuse it also emails a security notice.
 */
@CommandHandler(RevokeAdminSessionsCommand)
export class RevokeAdminSessionsCommandHandler implements ICommandHandler<RevokeAdminSessionsCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param adminWriterPort The port used to load and save the admin aggregate
     * @param emailerPort The port used to send the security notice
     * @param sessionPort The port used to push the session version to Redis
     * @param auditPort The port used to record the revocation
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the revocation.
     *
     * @param command The command payload
     */
    async execute(command: RevokeAdminSessionsCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        // Removed between the request and this handler; nothing to revoke.
        if (!admin) {
            return;
        }

        admin.revokeSessions();

        // The save is the security outcome: the DB counters are what every later refresh is
        // checked against.
        await this.adminWriterPort.save(admin);
        await this.auditPort.record({ action: AuditAction.ADMIN_SESSIONS_REVOKED, targetId: admin.id });

        // Best-effort instant eviction of the access tokens. Redis being unreachable only delays
        // the cut-off, so the failure is swallowed.
        this.sessionPort.setVersion(admin.id, admin.sessionVersion).catch(() => {});

        await this.notify(command.reason, admin.email, admin.name);
    }

    /**
     * Sends the notice the reason calls for: a possibly stolen token warrants a warning, the
     * owner's own logout-all does not.
     *
     * @param reason Why the sessions were revoked
     * @param to The account owner's email address
     * @param name The account owner's display name
     */
    private async notify(reason: SessionRevocationReason, to: string, name: string) {
        switch (reason) {
            case SessionRevocationReason.REFRESH_REUSE:
                await this.emailerPort.sendEmail(this.buildSecurityEmail(to, name));
                return;
            case SessionRevocationReason.LOGOUT_ALL:
                return;
            default:
                assertRevocationReasonExhausted(reason);
        }
    }

    /**
     * Builds the security notice, advising (not forcing) a password change.
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
                `<p>Hi ${name},</p>` +
                `<p>We noticed a sign-in token for your account was reused after it had already been rotated, ` +
                `which can indicate the token was stolen. As a precaution we signed you out of every device.</p>` +
                `<p>You can sign back in with your usual password. For your security we strongly recommend ` +
                `changing your password as soon as you sign in.</p>` +
                `<p>If you did not expect this, please change your password immediately.</p>`,
        };
    }
}

/**
 * Exhaustiveness guard for the notice `switch`: a new {@link SessionRevocationReason} member
 * without a `case` fails compilation here. Reaching it at runtime is a bug, hence 500 + Sentry.
 *
 * @param reason The reason no `case` claimed
 * @throws {SystemException} Always.
 */
function assertRevocationReasonExhausted(reason: never): never {
    throw new SystemException(`Unhandled session revocation reason: ${String(reason)}`, {
        context: { class: RevokeAdminSessionsCommandHandler.name, method: assertRevocationReasonExhausted.name },
    });
}
