/**
 * @file job-queue-operations.module.ts
 * @description Wires restricted read-only dead-letter operations.
 */

import { Module } from '@nestjs/common';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { JobQueueModule } from 'src/core/job-queue';
import { GetDeadLetterJobQueryHandler } from 'src/module/job-queue-operations/application/query/get-dead-letter-job/handler';
import { TOKEN_GET_DEAD_LETTER_JOB_PORT } from 'src/module/job-queue-operations/application/query/get-dead-letter-job/port';
import { ListDeadLetterJobsQueryHandler } from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/handler';
import { TOKEN_LIST_DEAD_LETTER_JOBS_PORT } from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/port';
import { JobQueueOperationsReaderAdapter } from 'src/module/job-queue-operations/infrastructure/adapter/job-queue-operations-reader.adapter';
import { JobQueueOperationsController } from 'src/module/job-queue-operations/presentation/controller/job-queue-operations.controller';

/**
 * Exposes protected reads over pg-boss-owned dead-letter data without owning a table.
 */
@Module({
    imports: [CqrsPipelineModule, JobQueueModule],
    controllers: [JobQueueOperationsController],
    providers: [
        JobQueueOperationsReaderAdapter,
        ListDeadLetterJobsQueryHandler,
        GetDeadLetterJobQueryHandler,
        { provide: TOKEN_LIST_DEAD_LETTER_JOBS_PORT, useExisting: JobQueueOperationsReaderAdapter },
        { provide: TOKEN_GET_DEAD_LETTER_JOB_PORT, useExisting: JobQueueOperationsReaderAdapter },
    ],
})
export class JobQueueOperationsModule {}
