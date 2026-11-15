/**
 * @file job-queue-operations.module.ts
 * @description Wires restricted dead-letter reads, discard, and asynchronous redrive.
 */

import { Module } from '@nestjs/common';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { DatabaseModule } from 'src/core/database';
import { IdempotencyModule } from 'src/core/idempotency';
import { JobQueueModule } from 'src/core/job-queue';
import { AuditModule } from 'src/core/observability/audit';
import { DiscardDeadLetterJobsCommandHandler } from 'src/module/job-queue-operations/application/command/discard-dead-letter-jobs/handler';
import { DiscardFailedDeadLetterRedrivesCommandHandler } from 'src/module/job-queue-operations/application/command/discard-failed-dead-letter-redrives/handler';
import { RedriveDeadLetterJobsCommandHandler } from 'src/module/job-queue-operations/application/command/redrive-dead-letter-jobs/handler';
import { StartDeadLetterRedriveCommandHandler } from 'src/module/job-queue-operations/application/command/start-dead-letter-redrive/handler';
import { DeadLetterRedriveConsumer } from 'src/module/job-queue-operations/application/consumer/dead-letter-redrive.consumer';
import { ListDeadLetterJobsQueryHandler } from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/handler';
import { ListDeadLetterRedrivesQueryHandler } from 'src/module/job-queue-operations/application/query/list-dead-letter-redrives/handler';
import { TOKEN_LIST_DEAD_LETTER_REDRIVES_PORT } from 'src/module/job-queue-operations/application/query/list-dead-letter-redrives/port';
import { JobQueueOperationsDeadLetterReaderAdapter } from 'src/module/job-queue-operations/infrastructure/adapter/job-queue-operations-dead-letter-reader.adapter';
import { JobQueueOperationsController } from 'src/module/job-queue-operations/presentation/controller/job-queue-operations.controller';

/**
 * Exposes protected reads, exact discard, and asynchronous redrive over pg-boss-owned data.
 */
@Module({
    imports: [
        AuditModule,
        CqrsPipelineModule,
        DatabaseModule,
        IdempotencyModule,
        JobQueueModule,
        JobQueueModule.forFeature([DeadLetterRedriveConsumer], [CqrsPipelineModule]),
    ],
    controllers: [JobQueueOperationsController],
    providers: [
        JobQueueOperationsDeadLetterReaderAdapter,
        DiscardDeadLetterJobsCommandHandler,
        DiscardFailedDeadLetterRedrivesCommandHandler,
        StartDeadLetterRedriveCommandHandler,
        RedriveDeadLetterJobsCommandHandler,
        ListDeadLetterJobsQueryHandler,
        ListDeadLetterRedrivesQueryHandler,
        { provide: TOKEN_LIST_DEAD_LETTER_REDRIVES_PORT, useExisting: JobQueueOperationsDeadLetterReaderAdapter },
    ],
})
export class JobQueueOperationsModule {}
