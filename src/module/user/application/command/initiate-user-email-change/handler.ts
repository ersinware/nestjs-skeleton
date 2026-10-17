/**
 * @file handler.ts
 * @description Verifies the current password and atomically persists an email request, delivery job, and audit.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { InitiateUserEmailChangeCommand } from 'src/module/user/application/command/initiate-user-email-change/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import {
    TOKEN_IS_USER_EMAIL_IN_USE_PORT,
    type IIsUserEmailInUsePort,
} from 'src/module/user/application/query/is-user-email-in-use/port';
import { ResourceNotFoundException, isExceptionWithAudit } from 'src/shared/exception';

/**
 * Starts a confirmation request without changing the current email or sessions.
 */
@CommandHandler(InitiateUserEmailChangeCommand)
export class InitiateUserEmailChangeCommandHandler implements ICommandHandler<InitiateUserEmailChangeCommand, void> {
    /**
     * Initializes the request dependencies.
     *
     * @param transactionPort Commits account state, delivery, and audit together
     * @param userWriterPort Loads and saves authoritative account state
     * @param hashingPort Verifies the current password outside the transaction
     * @param emailInUsePort Checks the target against existing account addresses
     * @param auditPort Records the request or failed password proof
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_IS_USER_EMAIL_IN_USE_PORT) private readonly emailInUsePort: IIsUserEmailInUsePort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Verifies ownership before creating a replacement request.
     *
     * @param command The authenticated account and password proof
     * @throws {ResourceNotFoundException} When the account no longer exists
     * @throws {SystemException} When a deleted account reaches this authenticated flow, or the queue does not accept every required job
     * @throws {InvalidInputException} When the password is wrong or the address is unchanged
     * @throws {ResourceConflictException} When the address is in use or the loaded account changed
     * @throws {AccessDeniedException} When the account is banned
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     */
    async execute(command: InitiateUserEmailChangeCommand) {
        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        try {
            user.requestEmailChange(
                command.newEmail,
                await this.hashingPort.verify(user.password, command.password),
                (await this.emailInUsePort.isEmailInUse(command.newEmail)).isInUse,
            );
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        await this.transactionPort.run(async () => {
            await this.userWriterPort.save(user);
            await this.auditPort.record({ action: AuditAction.EMAIL_CHANGE_REQUESTED });
        });
    }
}
