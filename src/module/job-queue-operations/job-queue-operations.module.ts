/**
 * @file job-queue-operations.module.ts
 * @description Wires restricted dead-letter reads, discard, and asynchronous redrive.
 */

import { Module } from '@nestjs/common';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { DatabaseModule } from 'src/core/database';
import { JobQueueModule } from 'src/core/job-queue';
import { AuditModule } from 'src/core/observability/audit';
import { DiscardDeadLetterJobsCommandHandler } from 'src/module/job-queue-operations/application/command/discard-dead-letter-jobs/handler';
import { RedriveDeadLetterJobsCommandHandler } from 'src/module/job-queue-operations/application/command/redrive-dead-letter-jobs/handler';
import { StartDeadLetterRedriveCommandHandler } from 'src/module/job-queue-operations/application/command/start-dead-letter-redrive/handler';
import { GetDeadLetterJobQueryHandler } from 'src/module/job-queue-operations/application/query/get-dead-letter-job/handler';
import { TOKEN_GET_DEAD_LETTER_JOB_PORT } from 'src/module/job-queue-operations/application/query/get-dead-letter-job/port';
import { GetDeadLetterRedriveQueryHandler } from 'src/module/job-queue-operations/application/query/get-dead-letter-redrive/handler';
import { TOKEN_GET_DEAD_LETTER_REDRIVE_PORT } from 'src/module/job-queue-operations/application/query/get-dead-letter-redrive/port';
import { ListDeadLetterJobsQueryHandler } from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/handler';
import { TOKEN_LIST_DEAD_LETTER_JOBS_PORT } from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/port';
import { DeadLetterRedriveQueue } from 'src/module/job-queue-operations/application/queue/dead-letter-redrive.queue';
import { JobQueueOperationsReaderAdapter } from 'src/module/job-queue-operations/infrastructure/adapter/job-queue-operations-reader.adapter';
import { JobQueueOperationsController } from 'src/module/job-queue-operations/presentation/controller/job-queue-operations.controller';

/**
 * Exposes protected reads, exact discard, and asynchronous redrive over pg-boss-owned data.
 */
@Module({
    imports: [
        AuditModule,
        CqrsPipelineModule,
        DatabaseModule,
        JobQueueModule,
        JobQueueModule.forFeature([DeadLetterRedriveQueue], [CqrsPipelineModule]),
    ],
    controllers: [JobQueueOperationsController],
    providers: [
        JobQueueOperationsReaderAdapter,
        DiscardDeadLetterJobsCommandHandler,
        StartDeadLetterRedriveCommandHandler,
        RedriveDeadLetterJobsCommandHandler,
        ListDeadLetterJobsQueryHandler,
        GetDeadLetterJobQueryHandler,
        GetDeadLetterRedriveQueryHandler,
        { provide: TOKEN_LIST_DEAD_LETTER_JOBS_PORT, useExisting: JobQueueOperationsReaderAdapter },
        { provide: TOKEN_GET_DEAD_LETTER_JOB_PORT, useExisting: JobQueueOperationsReaderAdapter },
        { provide: TOKEN_GET_DEAD_LETTER_REDRIVE_PORT, useExisting: JobQueueOperationsReaderAdapter },
    ],
})
export class JobQueueOperationsModule {}
