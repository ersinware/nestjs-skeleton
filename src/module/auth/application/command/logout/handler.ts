/**
 * @file handler.ts
 * @description Handles the LogoutCommand by closing the session bound to the verified refresh token.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { LogoutCommand } from 'src/module/auth/application/command/logout/command';
import { ExceptionKind, isExceptionOfKind } from 'src/shared/exception';

/**
 * Handler for the LogoutCommand.
 * Closes the single session the verified refresh token names; an unverifiable token is a silent
 * no-op, without claiming that malformed credentials identified a server-side session.
 */
@CommandHandler(LogoutCommand)
export class LogoutCommandHandler implements ICommandHandler<LogoutCommand, void> {
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
            payload = await this.tokenPort.verifyLogoutToken(command.refreshToken);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                return;
            }

            throw error;
        }

        await this.sessionPort.closeSession(payload.sub, payload.principalType, payload.sid);

        await this.auditPort.record({ action: AuditAction.LOGOUT, targetId: payload.sub });
    }
}
