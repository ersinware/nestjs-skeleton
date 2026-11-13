/**
 * @file handler.ts
 * @description Handles the LogoutCommand by closing the session bound to the verified refresh token.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { REFRESH_TOKEN_TYPE, TOKEN_AUTH_REFRESH_TOKEN_PORT, type RefreshTokenPayload } from 'src/core/security/auth';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { type ITokenPort } from 'src/core/security/token';
import { LogoutCommand } from 'src/module/auth/application/command/logout/command';
import { ExceptionKind, isExceptionOfKind } from 'src/shared/exception';
import { nowEpochSeconds } from 'src/shared/time';

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
     * @param refreshTokenPort The port used to verify the refresh token
     * @param sessionPort The port used to close the refresh session
     */
    constructor(
        @Inject(TOKEN_AUTH_REFRESH_TOKEN_PORT) private readonly refreshTokenPort: ITokenPort<typeof REFRESH_TOKEN_TYPE>,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
    ) {}

    /**
     * Executes the logout command.
     *
     * @param command The logout command parameters
     * @throws {DependencyUnavailableException} When session closure is unavailable
     */
    async execute(command: LogoutCommand) {
        let payload: RefreshTokenPayload;

        try {
            payload = await this.refreshTokenPort.verify<RefreshTokenPayload>(
                command.refreshToken,
                REFRESH_TOKEN_TYPE,
                { ignoreExpiration: true },
            );
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                return;
            }

            throw error;
        }

        if (payload.sessionExpiresAt <= nowEpochSeconds()) {
            return;
        }

        await this.sessionPort.closeSession(payload.sub, payload.principalType, payload.sid);
    }
}
