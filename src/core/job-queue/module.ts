/**
 * @file module.ts
 * @description Shares queue storage and its database pool across all callers.
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/core/database';
import { JobQueueAdapter } from 'src/core/job-queue/adapter/job-queue.adapter';
import { TOKEN_JOB_QUEUE_PORT } from 'src/core/job-queue/port/job-queue.port';
import { ErrorReporterModule } from 'src/core/observability/error-reporter';
import { LoggerModule } from 'src/core/observability/logger';

/**
 * Owns storage lifecycle once per application, regardless of the number of importing modules.
 */
@Module({
    imports: [DatabaseModule, LoggerModule, ErrorReporterModule],
    providers: [{ provide: TOKEN_JOB_QUEUE_PORT, useClass: JobQueueAdapter }],
    exports: [TOKEN_JOB_QUEUE_PORT],
})
export class JobQueueModule {}
