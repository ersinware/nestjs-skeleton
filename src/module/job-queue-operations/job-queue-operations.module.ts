/**
 * @file job-queue-operations.module.ts
 * @description Wires restricted dead-letter read and discard operations.
 */

import { Module } from '@nestjs/common';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { DatabaseModule } from 'src/core/database';
import { JobQueueModule } from 'src/core/job-queue';
import { AuditModule } from 'src/core/observability/audit';
import { DiscardDeadLetterJobsCommandHandler } from 'src/module/job-queue-operations/application/command/discard-dead-letter-jobs/handler';
import { GetDeadLetterJobQueryHandler } from 'src/module/job-queue-operations/application/query/get-dead-letter-job/handler';
import { TOKEN_GET_DEAD_LETTER_JOB_PORT } from 'src/module/job-queue-operations/application/query/get-dead-letter-job/port';
import { ListDeadLetterJobsQueryHandler } from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/handler';
import { TOKEN_LIST_DEAD_LETTER_JOBS_PORT } from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/port';
import { JobQueueOperationsReaderAdapter } from 'src/module/job-queue-operations/infrastructure/adapter/job-queue-operations-reader.adapter';
import { JobQueueOperationsController } from 'src/module/job-queue-operations/presentation/controller/job-queue-operations.controller';

/**
 * Exposes protected reads and exact discard over pg-boss-owned dead-letter data.
 */
@Module({
    imports: [AuditModule, CqrsPipelineModule, DatabaseModule, JobQueueModule],
    controllers: [JobQueueOperationsController],
    providers: [
        JobQueueOperationsReaderAdapter,
        DiscardDeadLetterJobsCommandHandler,
        ListDeadLetterJobsQueryHandler,
        GetDeadLetterJobQueryHandler,
        { provide: TOKEN_LIST_DEAD_LETTER_JOBS_PORT, useExisting: JobQueueOperationsReaderAdapter },
        { provide: TOKEN_GET_DEAD_LETTER_JOB_PORT, useExisting: JobQueueOperationsReaderAdapter },
    ],
})
export class JobQueueOperationsModule {}
