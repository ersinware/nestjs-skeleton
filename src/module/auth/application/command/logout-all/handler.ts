/**
 * @file handler.ts
 * @description Handles the LogoutAllCommand by closing all active sessions for the specified identity.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security';
import { LogoutAllCommand } from 'src/module/auth/application/command/logout-all/command';

/**
 * Handler for the LogoutAllCommand.
 * Revokes all sessions belonging to the user/admin.
 */
@CommandHandler(LogoutAllCommand)
export class LogoutAllCommandHandler implements ICommandHandler<LogoutAllCommand> {
    constructor(@Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort) {}

    /**
     * Executes the logout all command.
     *
     * @param command The logout all command parameters
     */
    async execute(command: LogoutAllCommand): Promise<void> {
        const { role, sub } = command;

        await Promise.all([this.sessionPort.closeAllSessions(role, sub), this.sessionPort.ban(role, sub)]);
    }
}
