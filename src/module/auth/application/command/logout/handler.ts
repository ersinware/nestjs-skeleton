/**
 * @file handler.ts
 * @description Handles the LogoutCommand by closing the caller's refresh session on a best-effort basis.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { LogoutCommand } from 'src/module/auth/application/command/logout/command';

/**
 * Handler for the LogoutCommand.
 * Revokes the specific JWT session.
 */
@CommandHandler(LogoutCommand)
export class LogoutCommandHandler implements ICommandHandler<LogoutCommand> {
    constructor(
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
    ) {}

    /**
     * Executes the logout command.
     *
     * @param command The logout command parameters
     */
    async execute(command: LogoutCommand): Promise<void> {
        let payload;

        try {
            payload = await this.tokenPort.verifyRefreshToken(command.refreshToken);
        } catch {
            return;
        }

        await this.sessionPort.closeSession(payload.sub, payload.jti);
    }
}
