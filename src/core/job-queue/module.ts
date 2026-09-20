/**
 * @file module.ts
 * @description Exposes job publishing and feature consumer registration.
 */

import { DynamicModule, Module, type ModuleMetadata, Type } from '@nestjs/common';
import { DatabaseModule } from 'src/core/database';
import { JobQueueWriterAdapter } from 'src/core/job-queue/adapter/job-queue-writer.adapter';
import { type IJobConsumer } from 'src/core/job-queue/job-consumer.interface';
import { JobQueueCoreModule } from 'src/core/job-queue/job-queue-core.module';
import { JobQueueFeatureModule, TOKEN_FEATURE_CONSUMERS } from 'src/core/job-queue/job-queue-feature.module';
import { TOKEN_JOB_QUEUE_WRITER_PORT } from 'src/core/job-queue/port/job-queue-writer.port';
import { ErrorReporterModule } from 'src/core/observability/error-reporter';

/**
 * Provides durable job publishing and feature-specific worker modules.
 */
@Module({
    imports: [DatabaseModule, JobQueueCoreModule],
    providers: [{ provide: TOKEN_JOB_QUEUE_WRITER_PORT, useClass: JobQueueWriterAdapter }],
    exports: [TOKEN_JOB_QUEUE_WRITER_PORT],
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
