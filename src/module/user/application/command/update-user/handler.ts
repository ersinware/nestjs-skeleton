/**
 * @file handler.ts
 * @description Handles UpdateUserCommand. Applies display-name changes to the User aggregate root and persists it.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { UpdateUserCommand } from 'src/module/user/application/command/update-user/command';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Updates the display name on an existing user.
 */
@CommandHandler(UpdateUserCommand)
export class UpdateUserCommandHandler implements ICommandHandler<UpdateUserCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param userWriterPort The port used to load and save the user aggregate
     * @param auditPort The port used to record the profile change for the audit trail
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the update user command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When no active user exists with the given ID
     */
    async execute(command: UpdateUserCommand) {
        const { id, name } = command;

        const user = await this.userWriterPort.load(id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        // An unchanged name requires no persistence or mutation audit.
        if (!user.updateName(name)) {
            return;
        }

        await this.transactionPort.run(async () => {
            await this.userWriterPort.save(user);
            await this.auditPort.record({ action: AuditAction.USER_UPDATED });
        });
    }
}
