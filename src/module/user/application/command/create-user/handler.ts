/**
 * @file handler.ts
 * @description Handles CreateUserCommand. Creates and persists a new User aggregate root,
 * returning only the generated ID so the presentation layer can re-query via the read path.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { ITransactionalOutboxPort } from 'src/core/outbox/port';
import { TOKEN_TRANSACTIONAL_OUTBOX_PORT } from 'src/core/outbox/port';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security';
import { CreateUserCommand } from 'src/module/user/application/command/create-user/command';
import { TOKEN_USER_WRITER_PORT, type IUserWriterPort } from 'src/module/user/application/command/port';
import { User } from 'src/module/user/domain/aggregate';
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
     * @param transactionalOutboxPort The port used for database transactions
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_TRANSACTIONAL_OUTBOX_PORT) private readonly transactionalOutboxPort: ITransactionalOutboxPort,
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

        await this.transactionalOutboxPort.run(() => this.userWriterPort.save(user), user);

        return user.id;
    }
}
