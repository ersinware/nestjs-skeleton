/**
 * @file job-queue-operations.adapter.ts
 * @description Adapts the approved dead-letter operations to the shared pg-boss client.
 */

import { Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { fromDrizzle, type JobWithMetadata, type PgBoss } from 'pg-boss';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import { JOB_QUEUE_DEAD_LETTER, JOB_QUEUE_DEAD_LETTER_REDRIVE } from 'src/core/job-queue/dead-letter-queue.constant';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { captureJobTraceparent, runInJobProducerSpan } from 'src/core/job-queue/job-trace-context';
import { type IJobQueueDeadLetterMetricsPort } from 'src/core/job-queue/port/job-queue-dead-letter-metrics.port';
import { type IJobQueueDeadLetterOperatorPort } from 'src/core/job-queue/port/job-queue-dead-letter-operator.port';
import {
    type DeadLetterJob,
    type DeadLetterJobPage,
    type DeadLetterRedriveOperation,
    type IJobQueueDeadLetterReaderPort,
} from 'src/core/job-queue/port/job-queue-dead-letter-reader.port';
import { SystemException } from 'src/shared/exception';
import type { PaginationParams } from 'src/shared/pagination';

/**
 * Provides dead-letter operations without exposing the raw pg-boss client.
 */
@Injectable()
export class JobQueueOperationsAdapter
    implements IJobQueueDeadLetterMetricsPort, IJobQueueDeadLetterOperatorPort, IJobQueueDeadLetterReaderPort
{
    /**
     * Initializes the adapter with the primary executor and shared queue client.
     *
     * @param database Primary database executor
     * @param boss Shared pg-boss client
     */
    constructor(
        @Inject(TOKEN_DATABASE_CLIENT) private readonly database: NodePgDatabase,
        @Inject(TOKEN_JOB_QUEUE_CLIENT) private readonly boss: PgBoss,
    ) {}

    /**
     * Reads the current shared dead-letter ready count.
     *
     * @returns Number of dead-letter jobs ready for operator action
     */
    async getDeadLetterReadyCount(): Promise<number> {
        try {
            const row = (await this.boss.getQueueStats(JOB_QUEUE_DEAD_LETTER, { force: true }))[0];

            if (!row) {
                throw new SystemException('The job queue returned no dead-letter statistics.', {
                    context: { class: this.constructor.name, method: this.getDeadLetterReadyCount.name },
                });
            }

            return row.readyCount;
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Reads the current failed redrive-operation count.
     *
     * @returns Number of terminally failed redrive operations still retained
     */
    async getDeadLetterRedriveFailedCount(): Promise<number> {
        try {
            const row = (await this.boss.getQueueStats(JOB_QUEUE_DEAD_LETTER_REDRIVE, { force: true }))[0];

            if (!row) {
                throw new SystemException('The job queue returned no redrive-operation statistics.', {
                    context: { class: this.constructor.name, method: this.getDeadLetterRedriveFailedCount.name },
                });
            }

            return row.failedCount;
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Reads the oldest shared dead-letter creation time without loading job payloads.
     *
     * @returns Oldest creation time, or null when the queue is empty
     */
    async getOldestDeadLetterCreatedOn(): Promise<Date | null> {
        try {
            const result = await this.database.execute<{ oldest_created_on: unknown }>(sql`
                SELECT min(created_on) AS oldest_created_on
                FROM pgboss.job
                WHERE name = ${JOB_QUEUE_DEAD_LETTER}
            `),
                oldest = result.rows[0]?.oldest_created_on;

            // MIN returns null for an empty queue; a missing row yields undefined and must fail validation.
            if (oldest === null) {
                return null;
            }

            const _oldest = oldest instanceof Date ? oldest : typeof oldest === 'string' ? new Date(oldest) : null;
            if (_oldest === null || Number.isNaN(_oldest.getTime())) {
                throw new SystemException('The job queue returned an invalid oldest dead-letter timestamp.', {
                    context: { class: this.constructor.name, method: this.getOldestDeadLetterCreatedOn.name },
                });
            }

            return _oldest;
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Deletes exact IDs from the shared dead-letter queue through the ambient transaction.
     *
     * @param ids Dead-letter job identifiers
     * @returns Number of rows deleted
     */
    async discardDeadLetterJobs(ids: readonly string[]): Promise<number> {
        try {
            const result: unknown = await this.boss.deleteJob(JOB_QUEUE_DEAD_LETTER, [...ids], {
                db: fromDrizzle(this.database, sql),
            });

            if (!this.isMutationResult(result)) {
                throw new SystemException('The job queue returned an invalid discard result.', {
                    context: { class: this.constructor.name, method: this.discardDeadLetterJobs.name },
                });
            }

            return result.affected;
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Enqueues one exclusive redrive operation through the ambient transaction.
     *
     * @param operationId Caller-generated operation identifier
     * @returns Whether pg-boss accepted the operation
     */
    async enqueueDeadLetterRedrive(operationId: string): Promise<boolean> {
        try {
            return await runInJobProducerSpan(JOB_QUEUE_DEAD_LETTER_REDRIVE, async () => {
                const traceparent = captureJobTraceparent(),
                    acceptedId = await this.boss.send(
                        JOB_QUEUE_DEAD_LETTER_REDRIVE,
                        traceparent === undefined ? {} : { traceparent },
                        {
                            id: operationId,
                            db: fromDrizzle(this.database, sql),
                        },
                    );

                if (acceptedId === null) {
                    return false;
                }

                if (acceptedId !== operationId) {
                    throw new SystemException('The job queue returned an unexpected redrive operation identifier.', {
                        context: { class: this.constructor.name, method: this.enqueueDeadLetterRedrive.name },
                    });
                }

                return true;
            });
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Redrives one bounded batch to each job's recorded source queue.
     *
     * @param limit Internal maximum number of jobs to move
     * @returns Number of jobs moved
     */
    async redriveDeadLetterJobs(limit: number): Promise<number> {
        try {
            return await this.boss.redrive(JOB_QUEUE_DEAD_LETTER, { limit });
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Lists only the approved metadata from a bounded, newest-first pg-boss page.
     *
     * @param params Shared pagination parameters
     * @returns Sanitized page and count
     */
    async listDeadLetterJobs(params: PaginationParams): Promise<DeadLetterJobPage> {
        try {
            const [data, count] = await Promise.all([
                this.database.execute<{
                    id: string;
                    created_on: string;
                    source_name: string | null;
                    source_id: string | null;
                    source_created_on: string | null;
                    source_retry_count: number | null;
                    delivery_id: unknown;
                    aggregate_id: unknown;
                }>(sql`
                    SELECT id, created_on, source_name, source_id, source_created_on, source_retry_count,
                           data ->> 'deliveryId' AS delivery_id, data ->> 'aggregateId' AS aggregate_id
                    FROM pgboss.job
                    WHERE name = ${JOB_QUEUE_DEAD_LETTER}
                    ORDER BY created_on DESC, id DESC
                    LIMIT ${params.limit} OFFSET ${(params.page - 1) * params.limit}
                `),
                this.database.execute<{ total: string }>(sql`
                    SELECT count(*)::text AS total FROM pgboss.job WHERE name = ${JOB_QUEUE_DEAD_LETTER}
                `),
            ]);

            const total = Number(count.rows[0]?.total);
            if (!Number.isSafeInteger(total) || total < 0) {
                throw new SystemException('The job queue returned an invalid dead-letter count.', {
                    context: { class: this.constructor.name, method: this.listDeadLetterJobs.name },
                });
            }

            return {
                data: data.rows.map((row) =>
                    this.toDeadLetterJob({
                        id: row.id,
                        createdOn: row.created_on,
                        sourceName: row.source_name,
                        sourceId: row.source_id,
                        sourceCreatedOn: row.source_created_on,
                        sourceRetryCount: row.source_retry_count,
                        data: { deliveryId: row.delivery_id, aggregateId: row.aggregate_id },
                    }),
                ),
                total,
            };
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Loads and narrows one shared dead-letter job.
     *
     * @param id Dead-letter job identifier
     * @returns The job view, or null when absent
     */
    async getDeadLetterJob(id: string): Promise<DeadLetterJob | null> {
        try {
            const row = (await this.boss.findJobs<unknown>(JOB_QUEUE_DEAD_LETTER, { id }))[0];

            return !row ? null : this.toDeadLetterJob(row);
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Loads one redrive operation from its orchestration queue.
     *
     * @param operationId Redrive operation identifier
     * @returns The operation view, or null when absent
     */
    async getDeadLetterRedrive(operationId: string): Promise<DeadLetterRedriveOperation | null> {
        try {
            const row = (await this.boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id: operationId }))[0];

            return !row
                ? null
                : {
                      id: row.id,
                      state: row.state,
                      createdOn: row.createdOn,
                      completedOn: row.completedOn,
                  };
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Validates the pg-boss mutation response used for exact affected-row checks.
     *
     * @param value Unknown library response
     * @returns True when the affected count is available
     */
    private isMutationResult(value: unknown): value is {
        readonly affected: number;
    } {
        return (
            typeof value === 'object' &&
            value !== null &&
            'affected' in value &&
            typeof value.affected === 'number' &&
            Number.isInteger(value.affected) &&
            value.affected >= 0
        );
    }

    /**
     * Normalizes timestamps and removes pg-boss-only fields from a dead-letter job.
     *
     * @param job Persisted pg-boss job
     * @returns Internal dead-letter view
     * @throws {SystemException} When persisted provenance, identifiers, or timestamps are invalid
     */
    private toDeadLetterJob(
        job: Pick<JobWithMetadata<unknown>, 'id' | 'sourceName' | 'sourceId' | 'sourceRetryCount' | 'data'> & {
            readonly createdOn: Date | string;
            readonly sourceCreatedOn: Date | string | null;
        },
    ): DeadLetterJob {
        const { sourceName, sourceId, sourceRetryCount, data } = job,
            createdOn = typeof job.createdOn === 'string' ? new Date(job.createdOn) : job.createdOn,
            sourceCreatedOn =
                typeof job.sourceCreatedOn === 'string' ? new Date(job.sourceCreatedOn) : job.sourceCreatedOn;

        if (
            typeof sourceName !== 'string' ||
            sourceName.length === 0 ||
            typeof sourceId !== 'string' ||
            !isUUID(sourceId) ||
            typeof job.id !== 'string' ||
            !isUUID(job.id) ||
            !(createdOn instanceof Date) ||
            Number.isNaN(createdOn.getTime()) ||
            !(sourceCreatedOn instanceof Date) ||
            Number.isNaN(sourceCreatedOn.getTime()) ||
            typeof sourceRetryCount !== 'number' ||
            !Number.isInteger(sourceRetryCount) ||
            sourceRetryCount < 0 ||
            typeof data !== 'object' ||
            data === null ||
            !('deliveryId' in data) ||
            typeof data.deliveryId !== 'string' ||
            !isUUID(data.deliveryId) ||
            !('aggregateId' in data) ||
            typeof data.aggregateId !== 'string' ||
            !isUUID(data.aggregateId)
        ) {
            throw new SystemException('The dead-letter job has invalid provenance or identifiers.', {
                context: { class: this.constructor.name, method: this.toDeadLetterJob.name },
            });
        }

        return {
            id: job.id,
            createdOn,
            sourceName,
            sourceId,
            sourceCreatedOn,
            sourceRetryCount,
            deliveryId: data.deliveryId,
            aggregateId: data.aggregateId,
        };
    }
}
