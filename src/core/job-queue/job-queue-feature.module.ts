/**
 * @file job-queue-feature.module.ts
 * @description Registers feature consumers and starts their pg-boss workers.
 */

import { Inject, Module, OnApplicationBootstrap } from '@nestjs/common';
import { PgBoss, type JobResult, type Job as PgBossJob } from 'pg-boss';
import { translateConnectionFailure } from 'src/core/database';
import { JobQueueDatabaseAdapter } from 'src/core/job-queue/adapter/job-queue-database.adapter';
import { JOB_QUEUE_DEAD_LETTER } from 'src/core/job-queue/dead-letter-queue.constant';
import { type IJobConsumer } from 'src/core/job-queue/job-consumer.interface';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { provisionJobQueue } from 'src/core/job-queue/job-queue-provisioner';
import { runInJobConsumerSpan } from 'src/core/job-queue/job-trace-context';
import { Job } from 'src/core/job-queue/job.type';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { ExceptionKind, SystemException, isExceptionOfKind, toError } from 'src/shared/exception';

/**
 * Identifies the {@link IJobConsumer} instances registered by a feature module.
 */
export const TOKEN_FEATURE_CONSUMERS = Symbol();

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
                    disableDeadLetter: consumer.queueOptions?.disableDeadLetter ?? false,
                });
            } catch (error) {
                if (!isExceptionOfKind(translateConnectionFailure(error), ExceptionKind.DEPENDENCY_UNAVAILABLE)) {
                    this.errorReporterPort.report(error, {
                        class: JobQueueFeatureModule.name,
                        method: this.onApplicationBootstrap.name,
                    });
                }

                throw error;
            }

            const options = {
                batchSize: 1,
                pollingIntervalSeconds: consumer.workerOptions?.pollingIntervalSeconds ?? 1,
                localConcurrency: consumer.workerOptions?.localConcurrency ?? (consumer.transactional ? 3 : 5),
            } as const;

            if (consumer.transactional) {
                const transactionalOptions = {
                    ...options,
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
                const nonTransactionalOptions = { ...options, perJobResults: true } as const;

                await this.boss.work<Job, Error, typeof nonTransactionalOptions>(
                    consumer.name,
                    nonTransactionalOptions,
                    (jobs) => this.consumeWithResults(consumer, jobs),
                );
            }
        }
    }

    /**
     * Settles non-transactional work individually, bypassing retries only for explicit terminal failures.
     *
     * @param consumer Registered non-transactional consumer
     * @param jobs Claimed pg-boss jobs
     * @returns Completion, retry, or terminal failure dispositions for pg-boss to persist
     */
    private async consumeWithResults(consumer: IJobConsumer, jobs: PgBossJob<Job>[]): Promise<JobResult<Error>[]> {
        const results: JobResult<Error>[] = [];

        for (const job of jobs) {
            try {
                await this.consume(consumer, [job]);
                results.push({ id: job.id, status: 'completed' });
            } catch (error) {
                results.push({
                    id: job.id,
                    status: isExceptionOfKind(error, ExceptionKind.TERMINAL_JOB) ? 'deadletter' : 'failed',
                    output: toError(error),
                });
            }
        }

        return results;
    }

    /**
     * Traces and reports claimed deliveries before propagating failures to worker settlement.
     *
     * @param consumer Registered job consumer
     * @param jobs Claimed pg-boss jobs
     */
    private async consume(consumer: IJobConsumer, jobs: PgBossJob<Job>[]) {
        for (const job of jobs) {
            const { id, data } = job;

            await runInJobConsumerSpan(consumer.name, id, data.deliveryId, data.traceparent, async () => {
                try {
                    await consumer.consume(data);
                } catch (error) {
                    if (!isExceptionOfKind(translateConnectionFailure(error), ExceptionKind.DEPENDENCY_UNAVAILABLE)) {
                        this.errorReporterPort.report(error, {
                            class: JobQueueFeatureModule.name,
                            method: this.consume.name,
                            data: {
                                jobId: id,
                                queueName: consumer.name,
                                aggregateId: data.aggregateId,
                                deliveryId: data.deliveryId,
                            },
                        });
                    }

                    throw error;
                }
            });
        }
    }
}
