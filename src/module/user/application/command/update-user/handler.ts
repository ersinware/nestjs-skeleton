/**
 * @file handler.ts
 * @description Handles UpdateUserCommand. Applies profile changes to the User aggregate root and persists it.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import { type IUserWriterPort, TOKEN_USER_WRITER_PORT } from 'src/module/user/application/command/port';
import { UpdateUserCommand } from 'src/module/user/application/command/update-user/command';

/**
 * Updates profile fields on an existing user and returns the entity ID.
 */
@CommandHandler(UpdateUserCommand)
export class UpdateUserCommandHandler implements ICommandHandler<UpdateUserCommand> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and save the user aggregate
     */
    constructor(@Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort) {}

    /**
     * Executes the update user command.
     * When neither email nor name is provided the command is a no-op and the ID is returned immediately.
     *
     * @param command The command payload
     * @returns The unique identifier of the updated user
     * @throws {ResourceNotFoundException} When no active user exists with the given ID
     */
    async execute(command: UpdateUserCommand) {
        const { id, email, name } = command;

        if (!email && !name) {
            return;
        }

        const user = await this.userWriterPort.load(id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        user.updateProfile({ name, email });
        await this.userWriterPort.save(user);
    }
}
