/**
 * @file handler.ts
 * @description Handles CreateUserCommand. Creates and persists a new User aggregate root,
 * returning only the generated ID so the presentation layer can re-query via the read path.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { CreateUserCommand } from 'src/module/user/application/command/create-user/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { uuidv7 } from 'uuidv7';

/**
 * Creates a new user account and returns the generated entity ID.
 */
@CommandHandler(CreateUserCommand)
export class CreateUserCommandHandler implements ICommandHandler<CreateUserCommand> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to persist the user aggregate
     * @param hashingPort The port used to hash passwords
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
    ) {}

    /**
     * Executes the create user command.
     *
     * @param command The command payload
     * @returns The unique identifier of the newly created user
     * @throws {ResourceConflictException} When the email address is already in use
     */
    async execute(command: CreateUserCommand) {
        const { email, name, password } = command,
            user = User.create(uuidv7(), {
                email,
                name,
                password: await this.hashingPort.hash(password),
            });

        await this.userWriterPort.save(user);

        return user.id;
    }
}
