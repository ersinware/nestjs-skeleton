/**
 * @file handler.ts
 * @description Handles BanUserCommand. Bans the User aggregate root and persists it, then instantly
 * evicts existing sessions on a best-effort basis.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import { LogPayload } from 'src/core/observability';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security';
import { BanUserCommand } from 'src/module/user/application/command/ban-user/command';
import { TOKEN_USER_WRITER_PORT, type IUserWriterPort } from 'src/module/user/application/command/port';

/**
 * Bans an existing user, revoking all of their active sessions.
 */
@CommandHandler(BanUserCommand)
export class BanUserCommandHandler implements ICommandHandler<BanUserCommand> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and save the user aggregate
     * @param sessionPort The port used to push the session version to Redis
     * @param loggerPort The port used to record best-effort sync-write failures
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
    ) {}

    /**
     * Executes the ban user command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the user does not exist
     */
    async execute(command: BanUserCommand) {
        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        user.ban();
        await this.userWriterPort.save(user);

        try {
            await this.sessionPort.setVersion(command.id, user.version);
        } catch (error) {
            this.loggerPort.error(
                new LogPayload({ class: BanUserCommandHandler.name, method: this.execute.name, error }),
            );
        }
    }
}
