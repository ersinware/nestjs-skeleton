/**
 * @file handler.ts
 * @description Atomically enqueues a redrive operation and records the operator request.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT, type IJobQueueDeadLetterOperatorPort } from 'src/core/job-queue';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { StartDeadLetterRedriveCommand } from 'src/module/job-queue-operations/application/command/start-dead-letter-redrive/command';
import { JobQueueOperationsAuditAction } from 'src/module/job-queue-operations/shared/job-queue-operations-audit';
import { ResourceConflictException } from 'src/shared/exception';

/**
 * Commits an exclusive redrive request with durable operator audit evidence.
 */
@CommandHandler(StartDeadLetterRedriveCommand)
export class StartDeadLetterRedriveCommandHandler implements ICommandHandler<StartDeadLetterRedriveCommand, string> {
    /**
     * Initializes the handler with the transaction, queue operator, and audit ports.
     *
     * @param transactionPort Commit boundary for enqueue and audit
     * @param operatorPort Exclusive redrive operation enqueue port
     * @param auditPort Durable operator audit port
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT)
        private readonly operatorPort: IJobQueueDeadLetterOperatorPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Enqueues one operation and returns its identifier after the audit commits.
     *
     * @returns Identifier of the accepted redrive operation
     * @throws {ResourceConflictException} When another redrive is queued or active
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When the queue returns an invalid mutation result
     */
    async execute(): Promise<string> {
        const operationId = randomUUID();

        await this.transactionPort.start(async () => {
            const accepted = await this.operatorPort.enqueueDeadLetterRedrive(operationId);

            if (!accepted) {
                throw new ResourceConflictException('A dead-letter redrive is already in progress.');
            }

            await this.auditPort.record({
                action: JobQueueOperationsAuditAction.JOB_DEAD_LETTER_REDRIVE_REQUESTED,
                detail: { operationId },
            });
        });

        return operationId;
    }
}
