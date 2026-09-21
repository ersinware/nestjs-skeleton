/**
 * @file job-queue-feature.module.ts
 * @description Registers feature consumers and starts their pg-boss workers.
 */

import { Inject, Module, OnApplicationBootstrap } from '@nestjs/common';
import { PgBoss, type Job as PgBossJob } from 'pg-boss';
import { translateConnectionFailure } from 'src/core/database';
import { JobQueueDatabaseAdapter } from 'src/core/job-queue/adapter/job-queue-database.adapter';
import { JOB_QUEUE_DEAD_LETTER } from 'src/core/job-queue/dead-letter-queue.constant';
import { type IJobConsumer } from 'src/core/job-queue/job-consumer.interface';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { provisionJobQueue } from 'src/core/job-queue/job-queue-provisioner';
import { Job } from 'src/core/job-queue/job.type';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { DependencyUnavailableException, SystemException } from 'src/shared/exception';

/**
 * Identifies the consumers registered by a feature module.
 */
export const TOKEN_FEATURE_CONSUMERS = Symbol('TOKEN_FEATURE_CONSUMERS');

/**
 * Creates queues and workers for a feature's consumers.
 */
@Module({})
export class JobQueueFeatureModule implements OnApplicationBootstrap {
    /**
     * Initializes the module with the registered consumers and worker dependencies.
     *
     * @param boss Shared pg-boss client
     * @param jobQueueDatabaseAdapter Bridges transactional workers into the database context
     * @param errorReporterPort Reports actionable consumer failures
     * @param consumers Consumers registered by the feature
     */
    constructor(
        @Inject(TOKEN_JOB_QUEUE_CLIENT) private readonly boss: PgBoss,
        private readonly jobQueueDatabaseAdapter: JobQueueDatabaseAdapter,
        @Inject(TOKEN_ERROR_REPORTER_PORT) private readonly errorReporterPort: IErrorReporterPort,
        @Inject(TOKEN_FEATURE_CONSUMERS) private readonly consumers: IJobConsumer[],
    ) {}

    /**
     * Reconciles each queue and starts its worker in the declared transaction mode.
     */
    async onApplicationBootstrap() {
        for (const consumer of this.consumers) {
            try {
                if (consumer.name === JOB_QUEUE_DEAD_LETTER) {
                    throw new SystemException('The shared dead-letter queue cannot register a worker.', {
                        context: { class: JobQueueFeatureModule.name, method: this.onApplicationBootstrap.name },
                    });
                }

                await provisionJobQueue(this.boss, consumer.name, {
                    policy: consumer.queueOptions?.policy ?? 'standard',
                    deadLetter: consumer.queueOptions?.deadLetter ?? null,
                });
            } catch (error) {
                if (!(translateConnectionFailure(error) instanceof DependencyUnavailableException)) {
                    this.errorReporterPort.report(error, {
                        class: JobQueueFeatureModule.name,
                        method: this.onApplicationBootstrap.name,
                    });
                }

                throw error;
            }

            const options = {
                batchSize: 1,
                pollingIntervalSeconds: 2,
            } as const;

            if (consumer.transactional) {
                const transactionalOptions = {
                    ...options,
                    localConcurrency: 3,
                    transactional: true,
                } as const;

                await this.boss.work<Job, void, typeof transactionalOptions>(
                    consumer.name,
                    transactionalOptions,
                    (jobs, transaction) =>
                        this.jobQueueDatabaseAdapter.runInTransactionContext(transaction, () =>
                            this.consume(consumer, jobs),
                        ),
                );
            } else {
                await this.boss.work<Job>(consumer.name, { ...options, localConcurrency: 5 }, (jobs) =>
                    this.consume(consumer, jobs),
                );
            }
        }
    }

    /**
     * Runs claimed jobs and rethrows failures so pg-boss can retry them.
     *
     * @param consumer Registered job consumer
     * @param jobs Claimed pg-boss jobs
     */
    private async consume(consumer: IJobConsumer, jobs: PgBossJob<Job>[]) {
        for (const job of jobs) {
            try {
                await consumer.consume(job.data);
            } catch (error) {
                if (!(translateConnectionFailure(error) instanceof DependencyUnavailableException)) {
                    this.errorReporterPort.report(error, {
                        class: JobQueueFeatureModule.name,
                        method: 'boss.work',
                        data: job.data,
                    });
                }

                throw error;
            }
        }
    }
}
