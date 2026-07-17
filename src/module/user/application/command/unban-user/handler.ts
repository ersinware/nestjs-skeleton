/**
 * @file handler.ts
 * @description Handles UnbanUserCommand. Lifts the ban on the User aggregate root and persists it.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import { TOKEN_USER_WRITER_PORT, type IUserWriterPort } from 'src/module/user/application/command/port';
import { UnbanUserCommand } from 'src/module/user/application/command/unban-user/command';

/**
 * Lifts the ban on an existing user. Unlike banning, no session eviction is needed: the version is
 * monotonic and a fresh login mints a token at the current version.
 */
@CommandHandler(UnbanUserCommand)
export class UnbanUserCommandHandler implements ICommandHandler<UnbanUserCommand> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and save the user aggregate
     */
    constructor(@Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort) {}

    /**
     * Executes the unban user command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the user does not exist
     */
    async execute(command: UnbanUserCommand) {
        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        user.unban();
        await this.userWriterPort.save(user);
    }
}
