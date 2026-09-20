/**
 * @file job-queue-feature.module.ts
 * @description Registers feature consumers and starts their pg-boss workers.
 */

import { Inject, Module, OnApplicationBootstrap } from '@nestjs/common';
import { PgBoss, type Job as PgBossJob, type Queue, type UpdateQueueOptions } from 'pg-boss';
import { translateConnectionFailure } from 'src/core/database';
import { JobQueueDatabaseAdapter } from 'src/core/job-queue/adapter/job-queue-database.adapter';
import { type IJobConsumer } from 'src/core/job-queue/job-consumer.interface';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { Job } from 'src/core/job-queue/job.type';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { DependencyUnavailableException, SystemException } from 'src/shared/exception';

/**
 * Mutable defaults applied to every application-owned queue at startup.
 */
const JOB_QUEUE_MUTABLE_OPTIONS = {
    retryLimit: 10,
    retryDelay: 15,
    retryBackoff: true,
} as const satisfies UpdateQueueOptions;

/**
 * Immutable queue layout expected by every application-owned queue.
 */
const JOB_QUEUE_IMMUTABLE_OPTIONS = {
    policy: 'standard',
    partition: false,
} as const satisfies Pick<Queue, 'policy' | 'partition'>;

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
                await this.boss.createQueue(consumer.name, {
                    ...JOB_QUEUE_MUTABLE_OPTIONS,
                    ...JOB_QUEUE_IMMUTABLE_OPTIONS,
                });
                await this.reconcileQueueOptions(consumer.name);
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
     * Rejects incompatible immutable options and reconciles mutable options when needed.
     *
     * @param name Queue name to reconcile
     */
    private async reconcileQueueOptions(name: string) {
        const queue = await this.boss.getQueue(name);

        if (
            queue?.policy !== JOB_QUEUE_IMMUTABLE_OPTIONS.policy ||
            queue.partition !== JOB_QUEUE_IMMUTABLE_OPTIONS.partition
        ) {
            throw new SystemException(
                `Job queue "${name}" has immutable options incompatible with the application configuration.`,
                {
                    context: {
                        class: JobQueueFeatureModule.name,
                        method: this.reconcileQueueOptions.name,
                    },
                },
            );
        }

        if (
            queue.retryLimit !== JOB_QUEUE_MUTABLE_OPTIONS.retryLimit ||
            queue.retryDelay !== JOB_QUEUE_MUTABLE_OPTIONS.retryDelay ||
            queue.retryBackoff !== JOB_QUEUE_MUTABLE_OPTIONS.retryBackoff
        ) {
            await this.boss.updateQueue(name, JOB_QUEUE_MUTABLE_OPTIONS);
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
