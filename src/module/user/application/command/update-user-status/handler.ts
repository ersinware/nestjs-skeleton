/**
 * @file handler.ts
 * @description Handles UpdateUserStatusCommand. Applies status changes to the User aggregate root and persists it.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import type { ITransactionalOutboxPort } from 'src/core/outbox/port';
import { TOKEN_TRANSACTIONAL_OUTBOX_PORT } from 'src/core/outbox/port';
import { type IUserWriterPort, TOKEN_USER_WRITER_PORT } from 'src/module/user/application/command/port';
import { UpdateUserStatusCommand } from 'src/module/user/application/command/update-user-status/command';

/**
 * Updates the active status of an existing user.
 */
@CommandHandler(UpdateUserStatusCommand)
export class UpdateUserStatusCommandHandler implements ICommandHandler<UpdateUserStatusCommand> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and save the user aggregate
     * @param transactionalOutboxPort The port used for database transactions
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_TRANSACTIONAL_OUTBOX_PORT) private readonly transactionalOutboxPort: ITransactionalOutboxPort,
    ) {}

    /**
     * Executes the update user status command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the user does not exist
     */
    async execute(command: UpdateUserStatusCommand) {
        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        user.updateStatus(command.active);
        await this.transactionalOutboxPort.run(() => this.userWriterPort.save(user), user);
    }
}
