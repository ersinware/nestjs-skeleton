/**
 * @file handler.ts
 * @description Atomically discards exact dead-letter jobs and records operator audit evidence.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT, type IJobQueueDeadLetterOperatorPort } from 'src/core/job-queue';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { DiscardDeadLetterJobsCommand } from 'src/module/job-queue-operations/application/command/discard-dead-letter-jobs/command';
import { JobQueueOperationsAuditAction } from 'src/module/job-queue-operations/shared/job-queue-operations-audit';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Commits an all-or-nothing dead-letter discard with its audit entry.
 */
@CommandHandler(DiscardDeadLetterJobsCommand)
export class DiscardDeadLetterJobsCommandHandler implements ICommandHandler<DiscardDeadLetterJobsCommand, void> {
    /**
     * Initializes the handler with the transaction, queue operator, and audit ports.
     *
     * @param transactionPort Commit boundary for deletion and audit
     * @param operatorPort Exact dead-letter mutation port
     * @param auditPort Durable operator audit port
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT)
        private readonly operatorPort: IJobQueueDeadLetterOperatorPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Deletes every requested job or rolls back the entire operation.
     *
     * @param command Exact dead-letter job identifiers
     * @throws {ResourceNotFoundException} When any requested job is missing from the shared dead-letter queue
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When the queue returns an invalid mutation result
     */
    async execute(command: DiscardDeadLetterJobsCommand) {
        await this.transactionPort.start(async () => {
            const affected = await this.operatorPort.discardDeadLetterJobs(command.jobIds);

            if (affected !== command.jobIds.length) {
                throw new ResourceNotFoundException();
            }

            await this.auditPort.record({
                action: JobQueueOperationsAuditAction.JOB_DEAD_LETTER_DISCARDED,
                detail: { jobIds: command.jobIds, count: String(affected) },
            });
        });
    }
}
