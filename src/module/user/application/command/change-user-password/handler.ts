/**
 * @file handler.ts
 * @description Handles ChangeUserPasswordCommand. Verifies the current password and securely updates the User aggregate root.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InvalidRequestException, InvalidRequestType, ResourceNotFoundException } from 'src/core/exception';
import { LogPayload } from 'src/core/observability';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_HASHING_PORT, TOKEN_SESSION_PORT, type IHashingPort, type ISessionPort } from 'src/core/security';
import { ChangeUserPasswordCommand } from 'src/module/user/application/command/change-user-password/command';
import { TOKEN_USER_WRITER_PORT, type IUserWriterPort } from 'src/module/user/application/command/port';

/**
 * Changes the password for an existing user account.
 */
@CommandHandler(ChangeUserPasswordCommand)
export class ChangeUserPasswordCommandHandler implements ICommandHandler<ChangeUserPasswordCommand> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and save the user aggregate
     * @param hashingPort The port used to verify and hash passwords
     * @param sessionPort The port used to push the session version to Redis
     * @param loggerPort The port used to record best-effort sync-write failures
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
    ) {}

    /**
     * Executes the change user password command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the user does not exist
     * @throws {InvalidRequestException} When the current password is invalid or the new password is the same
     */
    async execute(command: ChangeUserPasswordCommand) {
        const { id, currentPassword, newPassword } = command,
            user = await this.userWriterPort.load(id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        const hashedPassword = user.password;

        if (!(await this.hashingPort.verify(hashedPassword, currentPassword))) {
            throw new InvalidRequestException(InvalidRequestType.CURRENT_PASSWORD_MISMATCH);
        }

        if (await this.hashingPort.verify(hashedPassword, newPassword)) {
            throw new InvalidRequestException(InvalidRequestType.PASSWORD_REUSE);
        }

        user.changePassword(await this.hashingPort.hash(newPassword));
        await this.userWriterPort.save(user);

        // A password change bumps the session version for a permanent cut-off of every token minted
        // before it.
        try {
            await this.sessionPort.setVersion(id, user.version);
        } catch (error) {
            this.loggerPort.error(
                new LogPayload({ class: ChangeUserPasswordCommandHandler.name, method: this.execute.name, error }),
            );
        }
    }
}
