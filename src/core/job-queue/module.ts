/**
 * @file module.ts
 * @description Exposes job publishing, dead-letter operations, and feature consumer registration.
 */

import { DynamicModule, Module, type ModuleMetadata, Type } from '@nestjs/common';
import { DatabaseModule } from 'src/core/database';
import { JobQueueOperationsAdapter } from 'src/core/job-queue/adapter/job-queue-operations.adapter';
import { JobQueueWriterAdapter } from 'src/core/job-queue/adapter/job-queue-writer.adapter';
import { DeadLetterMonitor } from 'src/core/job-queue/dead-letter-monitor';
import { type IJobConsumer } from 'src/core/job-queue/job-consumer.interface';
import { JobQueueCoreModule } from 'src/core/job-queue/job-queue-core.module';
import { JobQueueFeatureModule, TOKEN_FEATURE_CONSUMERS } from 'src/core/job-queue/job-queue-feature.module';
import { TOKEN_JOB_QUEUE_DEAD_LETTER_METRICS_PORT } from 'src/core/job-queue/port/job-queue-dead-letter-metrics.port';
import { TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT } from 'src/core/job-queue/port/job-queue-dead-letter-operator.port';
import { TOKEN_JOB_QUEUE_DEAD_LETTER_READER_PORT } from 'src/core/job-queue/port/job-queue-dead-letter-reader.port';
import { TOKEN_JOB_QUEUE_WRITER_PORT } from 'src/core/job-queue/port/job-queue-writer.port';
import { ErrorReporterModule } from 'src/core/observability/error-reporter';
import { LoggerModule } from 'src/core/observability/logger';

/**
 * Provides durable job publishing, restricted dead-letter operations, and feature worker modules.
 */
@Module({
    imports: [DatabaseModule, JobQueueCoreModule, ErrorReporterModule, LoggerModule],
    providers: [
        DeadLetterMonitor,
        { provide: TOKEN_JOB_QUEUE_WRITER_PORT, useClass: JobQueueWriterAdapter },
        JobQueueOperationsAdapter,
        {
            provide: TOKEN_JOB_QUEUE_DEAD_LETTER_METRICS_PORT,
            useExisting: JobQueueOperationsAdapter,
        },
        {
            provide: TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT,
            useExisting: JobQueueOperationsAdapter,
        },
        {
            provide: TOKEN_JOB_QUEUE_DEAD_LETTER_READER_PORT,
            useExisting: JobQueueOperationsAdapter,
        },
    ],
    exports: [
        TOKEN_JOB_QUEUE_WRITER_PORT,
        TOKEN_JOB_QUEUE_DEAD_LETTER_METRICS_PORT,
        TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT,
        TOKEN_JOB_QUEUE_DEAD_LETTER_READER_PORT,
    ],
})
export class JobQueueModule {
    /**
     * Registers consumers and the modules required by their command pipelines.
     *
     * @param consumers Consumer classes to register
     * @param imports Modules required by the consumers
     * @returns Dynamic module containing the feature workers
     */
    static forFeature(
        consumers: Type<IJobConsumer>[],
        imports: NonNullable<ModuleMetadata['imports']> = [],
    ): DynamicModule {
        return {
            module: JobQueueFeatureModule,
            imports: [JobQueueCoreModule, ErrorReporterModule, ...imports],
            providers: [
                ...consumers,
                {
                    provide: TOKEN_FEATURE_CONSUMERS,
                    useFactory: (...consumers: IJobConsumer[]) => consumers,
                    inject: consumers,
                },
            ],
        };
    }
}
