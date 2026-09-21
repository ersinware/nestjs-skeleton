/**
 * @file handler.ts
 * @description Requests account-wide access and refresh revocation from the owning module.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_JOB_QUEUE_WRITER_PORT, type IJobQueueWriterPort } from 'src/core/job-queue';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { LogoutAllCommand } from 'src/module/auth/application/command/logout-all/command';
import { AdminSessionRevocationJobQueue } from 'src/shared/domain/admin';
import { PrincipalType } from 'src/shared/domain/principal';
import { UserSessionRevocationJobQueue } from 'src/shared/domain/user';

/**
 * The logout-all queue owned by each principal context. Exhaustive over {@link PrincipalType} so a
 * new kind fails compilation here instead of routing nowhere.
 */
const LOGOUT_ALL_QUEUE_BY_PRINCIPAL_TYPE = {
    [PrincipalType.USER]: UserSessionRevocationJobQueue.LOGOUT_ALL,
    [PrincipalType.ADMIN]: AdminSessionRevocationJobQueue.LOGOUT_ALL,
} as const satisfies Record<PrincipalType, string>;

/**
 * Handler for the LogoutAllCommand.
 * Requests the version changes that invalidate outstanding access and refresh tokens.
 */
@CommandHandler(LogoutAllCommand)
export class LogoutAllCommandHandler implements ICommandHandler<LogoutAllCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param jobQueueWriterPort The port used to persist the logout-all job
     * @param transactionPort Commits the job and audit together
     * @param auditPort The port used to record the logout
     */
    constructor(
        @Inject(TOKEN_JOB_QUEUE_WRITER_PORT) private readonly jobQueueWriterPort: IJobQueueWriterPort,
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Requests revocation through the owner, which alone advances the DB session counters.
     * Redis session records expire by TTL; sweeping them could delete a concurrent new login.
     *
     * @param command The logout all command parameters
     */
    async execute(command: LogoutAllCommand) {
        await this.transactionPort.run(async () => {
            await this.jobQueueWriterPort.enqueue([
                {
                    deliveryId: randomUUID(),
                    aggregateId: command.id,
                    queueName: LOGOUT_ALL_QUEUE_BY_PRINCIPAL_TYPE[command.principalType],
                },
            ]);
            // The verified principal already identifies the actor in the audit context.
            await this.auditPort.record({ action: AuditAction.LOGOUT_ALL });
        });
    }
}
