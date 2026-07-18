/**
 * @file handler.ts
 * @description Handles the LogoutAllCommand by closing all active refresh sessions for the specified identity.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { LogoutAllCommand } from 'src/module/auth/application/command/logout-all/command';

/**
 * Handler for the LogoutAllCommand.
 * Revokes all refresh sessions belonging to the user/admin.
 */
@CommandHandler(LogoutAllCommand)
export class LogoutAllCommandHandler implements ICommandHandler<LogoutAllCommand> {
    constructor(@Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort) {}

    /**
     * Executes the logout all command by deleting every refresh session for the principal, so no
     * device can mint new tokens. Already-issued access tokens expire on their own short TTL.
     *
     * @param command The logout all command parameters
     */
    async execute(command: LogoutAllCommand): Promise<void> {
        await this.sessionPort.closeAllSessions(command.sub);
    }
}
