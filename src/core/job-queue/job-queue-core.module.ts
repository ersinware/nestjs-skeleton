/**
 * @file job-queue-core.module.ts
 * @description Configures the shared pg-boss client and its PostgreSQL pool.
 */

import { BeforeApplicationShutdown, Inject, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgBoss } from 'pg-boss';
import { ENV } from 'src/core/config';
import { createDatabasePool, translateConnectionFailure } from 'src/core/database';
import { JobQueueDatabaseAdapter } from 'src/core/job-queue/adapter/job-queue-database.adapter';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import {
    ErrorReporterModule,
    TOKEN_ERROR_REPORTER_PORT,
    type IErrorReporterPort,
} from 'src/core/observability/error-reporter';
import { DependencyUnavailableException } from 'src/shared/exception';

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
                errorReporterPort: IErrorReporterPort,
            ): Promise<PgBoss> => {
                const boss = new PgBoss({
                    db: jobQueueDatabaseAdapter,
                    schedule: false,
                });

                boss.on('error', (error) => {
                    if (!(translateConnectionFailure(error) instanceof DependencyUnavailableException)) {
                        errorReporterPort.report(error, { class: JobQueueCoreModule.name, method: 'boss.on' });
                    }
                });

                try {
                    await boss.start();

                    return boss;
                } catch (error) {
                    await boss.stop({ graceful: false });
                    await jobQueueDatabaseAdapter.close();

                    throw error;
                }
            },
            inject: [JobQueueDatabaseAdapter, TOKEN_ERROR_REPORTER_PORT],
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
