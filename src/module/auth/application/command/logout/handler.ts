/**
 * @file handler.ts
 * @description Handles the LogoutCommand by closing the caller's refresh session on a best-effort basis.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { LogoutCommand } from 'src/module/auth/application/command/logout/command';

/**
 * Handler for the LogoutCommand.
 * Revokes the specific JWT session.
 */
@CommandHandler(LogoutCommand)
export class LogoutCommandHandler implements ICommandHandler<LogoutCommand> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param tokenPort The port used to verify the refresh token
     * @param sessionPort The port used to close the refresh session
     * @param auditPort The port used to record the logout
     */
    constructor(
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the logout command.
     *
     * @param command The logout command parameters
     */
    async execute(command: LogoutCommand) {
        let payload;

        try {
            payload = await this.tokenPort.verifyRefreshToken(command.refreshToken);
        } catch {
            return;
        }

        await this.sessionPort.closeSession(payload.sub, payload.jti);

        // The unverifiable-token path above returns without a record on purpose: nothing was closed,
        // and the subject is unknown — there is no fact to file.
        //
        // `targetId` is kept here, unlike the self-scoped commands: the subject comes from the REFRESH
        // token in the body, not from the access token the guard verified, so it is not guaranteed to
        // be the actor. On the request where they differ — a principal closing a session that belongs
        // to someone else — that divergence is the whole of what the record is worth.
        this.auditPort.record({ action: AuditAction.LOGOUT, targetId: payload.sub });
    }
}
