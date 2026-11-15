/**
 * @file handler.ts
 * @description Atomically discards one failed dead-letter redrive operation and records operator audit evidence.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_IDEMPOTENCY_PORT, type IIdempotencyPort } from 'src/core/idempotency';
import {
    RedriveDiscardOutcome,
    TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT,
    type IJobQueueDeadLetterOperatorPort,
} from 'src/core/job-queue';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { DiscardFailedDeadLetterRedrivesCommand } from 'src/module/job-queue-operations/application/command/discard-failed-dead-letter-redrives/command';
import { JobQueueOperationsAuditAction } from 'src/module/job-queue-operations/shared/job-queue-operations-audit';
import { ResourceConflictException, ResourceNotFoundException, SystemException } from 'src/shared/exception';

/**
 * Commits the removal of a terminal failed redrive operation with its audit entry.
 */
@CommandHandler(DiscardFailedDeadLetterRedrivesCommand)
export class DiscardFailedDeadLetterRedrivesCommandHandler implements ICommandHandler<
    DiscardFailedDeadLetterRedrivesCommand,
    void
> {
    /**
     * Initializes the handler with the transaction, queue operator, and audit ports.
     *
     * @param idempotencyPort Commit boundary for deletion and audit
     * @param operatorPort Dead-letter redrive operator port
     * @param auditPort Durable operator audit port
     */
    constructor(
        @Inject(TOKEN_IDEMPOTENCY_PORT) private readonly idempotencyPort: IIdempotencyPort,
        @Inject(TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT)
        private readonly operatorPort: IJobQueueDeadLetterOperatorPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Deletes every requested failed redrive operation or rolls back the entire operation.
     *
     * @param command Validated logical request identity and exact redrive operation identifiers
     * @throws {ResourceNotFoundException} When any requested operation is absent or no longer retained
     * @throws {ResourceConflictException} When the key belongs to a different request or any requested operation is not failed
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When the queue returns an unknown or invalid mutation outcome
     */
    async execute(command: DiscardFailedDeadLetterRedrivesCommand) {
        await this.idempotencyPort.execute(command.idempotencyRequest, async () => {
            const outcome = await this.operatorPort.discardFailedDeadLetterRedrives(command.ids);

            switch (outcome) {
                case RedriveDiscardOutcome.DISCARDED:
                    break;
                case RedriveDiscardOutcome.NOT_FOUND:
                    throw new ResourceNotFoundException();
                case RedriveDiscardOutcome.NOT_FAILED:
                    throw new ResourceConflictException('Only failed dead-letter redrives can be discarded.');
                default:
                    this.assertOutcomeExhausted(outcome);
            }

            await this.auditPort.record({
                action: JobQueueOperationsAuditAction.JOB_DEAD_LETTER_REDRIVE_DISCARDED,
                detail: { ids: command.ids },
            });

            return { replayResultId: null };
        });
    }

    private assertOutcomeExhausted(outcome: never): never {
        throw new SystemException(`Unhandled dead-letter redrive discard outcome: ${String(outcome)}`, {
            context: { class: this.constructor.name, method: this.execute.name },
        });
    }
}
