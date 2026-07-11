/**
 * @file handler.ts
 * @description Handles ChangeUserPasswordCommand. Verifies the current password and securely updates the User aggregate root.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InvalidRequestException, InvalidRequestType, ResourceNotFoundException } from 'src/core/exception';
import type { ITransactionalOutboxPort } from 'src/core/outbox/port';
import { TOKEN_TRANSACTIONAL_OUTBOX_PORT } from 'src/core/outbox/port';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security';
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
     * @param transactionalOutboxPort The port used for database transactions
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_TRANSACTIONAL_OUTBOX_PORT) private readonly transactionalOutboxPort: ITransactionalOutboxPort,
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
        await this.transactionalOutboxPort.run(() => this.userWriterPort.save(user), user);
    }
}
