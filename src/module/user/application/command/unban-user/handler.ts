/**
 * @file handler.ts
 * @description Handles UnbanUserCommand. Lifts the ban on the User aggregate root and persists it.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { UnbanUserCommand } from 'src/module/user/application/command/unban-user/command';
import { UserAuditAction } from 'src/module/user/shared/user-audit';
import { ResourceNotFoundException, isExceptionWithAudit } from 'src/shared/exception';

/**
 * Lifts the ban on an existing user. Unlike banning, no session eviction is needed: the version is
 * monotonic and a fresh login mints a token at the current version.
 */
@CommandHandler(UnbanUserCommand)
export class UnbanUserCommandHandler implements ICommandHandler<UnbanUserCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param userWriterPort The port used to load and save the user aggregate
     * @param auditPort The port used to record the lifted ban for the audit trail
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the unban user command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the user does not exist
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When an account or actor invariant is violated, or required jobs are not accepted
     */
    async execute(command: UnbanUserCommand) {
        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        // `unban()` reports whether the account actually transitioned. On an account that is not
        // banned there is nothing to persist or audit — an entry for a ban that was never in place
        // would fabricate a fact.
        try {
            if (!user.unban(command.actor)) {
                return;
            }
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: user.id }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        await this.transactionPort.run(async () => {
            await this.userWriterPort.save(user);
            await this.auditPort.record({ action: UserAuditAction.USER_UNBANNED, targetId: user.id });
        });
    }
}
