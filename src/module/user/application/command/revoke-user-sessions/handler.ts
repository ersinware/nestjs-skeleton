/**
 * @file handler.ts
 * @description Handles RevokeUserSessionsCommand: bumps the user's session counters and notifies the
 * account owner when the reason calls for it.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { EmailPayload } from 'src/core/email';
import { TOKEN_EMAILER_PORT, type IEmailerPort } from 'src/core/email';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { RevokeUserSessionsCommand } from 'src/module/user/application/command/revoke-user-sessions/command';
import { SessionRevocationReason } from 'src/shared/domain/principal';
import { ExceptionKind, SystemException, isExceptionOfKind } from 'src/shared/exception';

/**
 * Revokes all of a user's sessions; on refresh-token reuse it also emails a security notice.
 */
@CommandHandler(RevokeUserSessionsCommand)
export class RevokeUserSessionsCommandHandler implements ICommandHandler<RevokeUserSessionsCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and save the user aggregate
     * @param emailerPort The port used to send the security notice
     * @param sessionPort The port used to push the session version to Redis
     * @param auditPort The port used to record the revocation
     * @param errorReporterPort The port used to report unexpected background session failures
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_ERROR_REPORTER_PORT) private readonly errorReporterPort: IErrorReporterPort,
    ) {}

    /**
     * Executes the revocation.
     *
     * @param command The command payload
     */
    async execute(command: RevokeUserSessionsCommand) {
        const user = await this.userWriterPort.load(command.id);

        // Removed between the request and this handler; nothing to revoke.
        if (!user) {
            return;
        }

        user.revokeSessions();

        // The save is the security outcome: the DB counters are what every later refresh is
        // checked against.
        await this.userWriterPort.save(user);
        await this.auditPort.record({ action: AuditAction.USER_SESSIONS_REVOKED, targetId: user.id });

        // Best-effort instant eviction of the access tokens. Redis being unreachable only delays
        // the cut-off; unexpected failures are reported without changing the response.
        void this.sessionPort.setVersion(user.id, user.sessionVersion).catch((error: unknown) => {
            if (isExceptionOfKind(error, ExceptionKind.DEPENDENCY_UNAVAILABLE)) {
                return;
            }

            this.errorReporterPort.report(error, {
                class: this.constructor.name,
                method: this.execute.name,
                message: 'Best-effort session version update failed.',
            });
        });

        await this.notify(command.reason, user.email, user.name);
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
        context: { class: RevokeUserSessionsCommandHandler.name, method: assertRevocationReasonExhausted.name },
    });
}
