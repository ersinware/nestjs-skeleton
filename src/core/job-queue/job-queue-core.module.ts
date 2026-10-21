/**
 * @file job-queue-core.module.ts
 * @description Configures the shared pg-boss client, operational queues, and PostgreSQL pool.
 */

import { BeforeApplicationShutdown, Inject, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgBoss } from 'pg-boss';
import { ENV, Environment } from 'src/core/config';
import { createDatabasePool, translateConnectionFailure } from 'src/core/database';
import { JobQueueDatabaseAdapter } from 'src/core/job-queue/adapter/job-queue-database.adapter';
import {
    JOB_QUEUE_DEAD_LETTER,
    JOB_QUEUE_DEAD_LETTER_OPTIONS,
    JOB_QUEUE_DEAD_LETTER_REDRIVE,
    JOB_QUEUE_DEAD_LETTER_REDRIVE_OPTIONS,
} from 'src/core/job-queue/dead-letter-queue.constant';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { provisionJobQueue } from 'src/core/job-queue/job-queue-provisioner';
import {
    ErrorReporterModule,
    TOKEN_ERROR_REPORTER_PORT,
    type IErrorReporterPort,
} from 'src/core/observability/error-reporter';
import { ExceptionKind, isExceptionOfKind } from 'src/shared/exception';

/**
 * Owns the pg-boss lifecycle and dedicated database pool.
 */
@Module({
    imports: [ErrorReporterModule],
    providers: [
        {
            provide: JobQueueDatabaseAdapter,
            useFactory: (configService: ConfigService): JobQueueDatabaseAdapter =>
                new JobQueueDatabaseAdapter(
                    createDatabasePool(
                        configService,
                        configService.getOrThrow<string>(ENV.DATABASE_URL),
                        configService.getOrThrow<number>(ENV.JOB_QUEUE_POOL_SIZE),
                    ),
                ),
            inject: [ConfigService],
        },
        {
            provide: TOKEN_JOB_QUEUE_CLIENT,
            useFactory: async (
                jobQueueDatabaseAdapter: JobQueueDatabaseAdapter,
                configService: ConfigService,
                errorReporterPort: IErrorReporterPort,
            ): Promise<PgBoss> => {
                const boss = new PgBoss({
                    db: jobQueueDatabaseAdapter,
                    migrate: configService.getOrThrow<Environment>(ENV.NODE_ENV) !== Environment.PRODUCTION,
                    schedule: false,
                });

                boss.on('error', (error) => {
                    if (!isExceptionOfKind(translateConnectionFailure(error), ExceptionKind.DEPENDENCY_UNAVAILABLE)) {
                        errorReporterPort.report(error, { class: JobQueueCoreModule.name, method: 'boss.on' });
                    }
                });

                try {
                    await boss.start();
                    await provisionJobQueue(boss, JOB_QUEUE_DEAD_LETTER, JOB_QUEUE_DEAD_LETTER_OPTIONS);
                    await provisionJobQueue(boss, JOB_QUEUE_DEAD_LETTER_REDRIVE, JOB_QUEUE_DEAD_LETTER_REDRIVE_OPTIONS);

                    return boss;
                } catch (error) {
                    await boss.stop({ graceful: false });
                    await jobQueueDatabaseAdapter.close();

                    throw error;
                }
            },
            inject: [JobQueueDatabaseAdapter, ConfigService, TOKEN_ERROR_REPORTER_PORT],
        },
    ],
    exports: [TOKEN_JOB_QUEUE_CLIENT, JobQueueDatabaseAdapter],
})
export class JobQueueCoreModule implements BeforeApplicationShutdown {
    /**
     * Initializes the module with its managed queue resources.
     *
     * @param boss Shared pg-boss client
     * @param jobQueueDatabaseAdapter Owner of the dedicated queue pool
     */
    constructor(
        @Inject(TOKEN_JOB_QUEUE_CLIENT) private readonly boss: PgBoss,
        private readonly jobQueueDatabaseAdapter: JobQueueDatabaseAdapter,
    ) {}

    /**
     * Stops workers before closing the queue pool.
     */
    async beforeApplicationShutdown() {
        try {
            await this.boss.stop({ graceful: true, timeout: 30000 });
        } finally {
            await this.jobQueueDatabaseAdapter.close();
        }
    }
}
