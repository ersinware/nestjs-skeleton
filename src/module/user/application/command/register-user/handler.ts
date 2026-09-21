/**
 * @file handler.ts
 * @description Handles RegisterUserCommand. Creates and persists a new User aggregate root.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { RegisterUserCommand } from 'src/module/user/application/command/register-user/command';
import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { uuidv7 } from 'uuidv7';

/**
 * Registers a new user account on the user's own behalf.
 */
@CommandHandler(RegisterUserCommand)
export class RegisterUserCommandHandler implements ICommandHandler<RegisterUserCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param userWriterPort The port used to persist the user aggregate
     * @param hashingPort The port used to hash passwords
     * @param auditPort The port used to record the registration for the audit trail
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the register user command.
     *
     * @param command The command payload
     * @throws {ResourceConflictException} When the email address is already in use
     */
    async execute(command: RegisterUserCommand) {
        const { email, name, password } = command,
            user = User.create({
                id: uuidv7(),
                email,
                name,
                password: await this.hashingPort.hash(password),
            });

        await this.transactionPort.run(async () => {
            await this.userWriterPort.save(user);
            await this.auditPort.record({ action: AuditAction.USER_REGISTERED, targetId: user.id });
        });
    }
}
