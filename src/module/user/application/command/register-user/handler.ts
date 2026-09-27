/**
 * @file handler.ts
 * @description Handles RegisterUserCommand. Persists a pending User and its activation delivery.
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
import { isExceptionWithAudit } from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

/**
 * Registers a pending user account and its activation delivery.
 */
@CommandHandler(RegisterUserCommand)
export class RegisterUserCommandHandler implements ICommandHandler<RegisterUserCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the account, delivery job, and audit
     * @param userWriterPort The port used to persist the user aggregate and its jobs
     * @param hashingPort The port used to hash passwords
     * @param auditPort The port used to record the pending registration
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Commits the pending account, initial delivery job, and registration audit together.
     *
     * @param command The command payload
     * @throws {ResourceConflictException} When the email address is already in use
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When the activation job is not accepted by the queue
     */
    async execute(command: RegisterUserCommand) {
        const id = uuidv7();

        let user;

        try {
            user = User.create({
                id,
                email: command.email,
                name: command.name,
                password: await this.hashingPort.hash(command.password),
            });
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        await this.transactionPort.run(async () => {
            await this.userWriterPort.save(user);
            await this.auditPort.record({ action: AuditAction.USER_REGISTERED, targetId: user.id });
        });
    }
}
