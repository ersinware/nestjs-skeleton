/**
 * @file handler.ts
 * @description Atomically enqueues a redrive operation and records the operator request.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import { TOKEN_IDEMPOTENCY_PORT, type IIdempotencyPort } from 'src/core/idempotency';
import { TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT, type IJobQueueDeadLetterOperatorPort } from 'src/core/job-queue';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { StartDeadLetterRedriveCommand } from 'src/module/job-queue-operations/application/command/start-dead-letter-redrive/command';
import { JobQueueOperationsAuditAction } from 'src/module/job-queue-operations/shared/job-queue-operations-audit';
import { ResourceConflictException, SystemException } from 'src/shared/exception';

/**
 * Commits an exclusive redrive request with durable operator audit evidence.
 */
@CommandHandler(StartDeadLetterRedriveCommand)
export class StartDeadLetterRedriveCommandHandler implements ICommandHandler<StartDeadLetterRedriveCommand, string> {
    /**
     * Initializes the handler with the transaction, queue operator, and audit ports.
     *
     * @param idempotencyPort Commit boundary for the request claim, enqueue, audit, and replay identity
     * @param operatorPort Exclusive redrive operation enqueue port
     * @param auditPort Durable operator audit port
     */
    constructor(
        @Inject(TOKEN_IDEMPOTENCY_PORT) private readonly idempotencyPort: IIdempotencyPort,
        @Inject(TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT)
        private readonly operatorPort: IJobQueueDeadLetterOperatorPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Enqueues one operation and returns its identifier after the audit commits.
     *
     * @param command Validated logical request identity
     * @returns Identifier of the accepted redrive operation
     * @throws {ResourceConflictException} When the key belongs to a different request or another redrive is queued or active
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When the queue returns an invalid mutation result or replay metadata is missing
     */
    async execute(command: StartDeadLetterRedriveCommand): Promise<string> {
        const { replayResultId } = await this.idempotencyPort.execute(command.idempotencyRequest, async () => {
            const operationId = randomUUID(),
                accepted = await this.operatorPort.enqueueDeadLetterRedrive(operationId);

            if (!accepted) {
                throw new ResourceConflictException('A dead-letter redrive is already in progress.');
            }

            await this.auditPort.record({
                action: JobQueueOperationsAuditAction.JOB_DEAD_LETTER_REDRIVE_REQUESTED,
                detail: { operationId },
            });

            return { replayResultId: operationId };
        });

        if (replayResultId === null) {
            throw new SystemException('The redrive idempotency operation has no replay identifier.', {
                context: { class: this.constructor.name, method: this.execute.name },
            });
        }

        return replayResultId;
    }
}
