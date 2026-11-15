/**
 * @file job-queue-dead-letter-reader.adapter.ts
 * @description Adapts dead-letter read and monitoring queries to the shared pg-boss client.
 */

import { Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { type JobWithMetadata, type PgBoss } from 'pg-boss';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import { JOB_QUEUE_DEAD_LETTER, JOB_QUEUE_DEAD_LETTER_REDRIVE } from 'src/core/job-queue/dead-letter-queue.constant';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { type IJobQueueDeadLetterMetricsPort } from 'src/core/job-queue/port/job-queue-dead-letter-metrics.port';
import {
    type DeadLetterJob,
    type DeadLetterJobPage,
    type DeadLetterRedrive,
    type DeadLetterRedrivePage,
    type IJobQueueDeadLetterReaderPort,
} from 'src/core/job-queue/port/job-queue-dead-letter-reader.port';
import { SystemException } from 'src/shared/exception';
import type { PaginationParams } from 'src/shared/pagination';

/**
 * Provides dead-letter read and metrics queries without exposing the raw pg-boss client.
 */
@Injectable()
export class JobQueueDeadLetterReaderAdapter implements IJobQueueDeadLetterReaderPort, IJobQueueDeadLetterMetricsPort {
    /**
     * Initializes the reader with the primary database executor and shared queue client.
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
                throw new SystemException('The job queue returned no redrive statistics.', {
                    context: {
                        class: this.constructor.name,
                        method: this.getDeadLetterRedriveFailedCount.name,
                    },
                });
            }

            return row.failedCount;
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
                total: Number(count.rows[0]?.total ?? 0),
            };
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Lists only the approved fields from a bounded, newest-first redrive operation page.
     *
     * @param params Shared pagination parameters
     * @returns Sanitized page and count
     */
    async listDeadLetterRedrives(params: PaginationParams): Promise<DeadLetterRedrivePage> {
        try {
            const [data, count] = await Promise.all([
                this.database.execute<{
                    id: string;
                    state: DeadLetterRedrive['state'];
                    created_on: Date | string;
                    completed_on: Date | string | null;
                }>(sql`
                    SELECT id, state, created_on, completed_on
                    FROM pgboss.job
                    WHERE name = ${JOB_QUEUE_DEAD_LETTER_REDRIVE}
                    ORDER BY created_on DESC, id DESC
                    LIMIT ${params.limit} OFFSET ${(params.page - 1) * params.limit}
                `),
                this.database.execute<{ total: string }>(sql`
                    SELECT count(*)::text AS total FROM pgboss.job WHERE name = ${JOB_QUEUE_DEAD_LETTER_REDRIVE}
                `),
            ]);

            return {
                data: data.rows.map((row) => this.toDeadLetterRedrive(row)),
                total: Number(count.rows[0]?.total ?? 0),
            };
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Normalizes timestamps and removes pg-boss-only fields from a dead-letter job.
     *
     * @param job.createdOn Dead-letter creation timestamp, accepted as a Date or database string.
     * @param job.sourceCreatedOn Original job creation timestamp; missing provenance is rejected.
     * @returns Internal dead-letter view
     * @throws {SystemException} When persisted provenance or payload identifiers are invalid
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
            sourceId.length === 0 ||
            !(sourceCreatedOn instanceof Date) ||
            typeof sourceRetryCount !== 'number' ||
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

    /**
     * Normalizes timestamps on a retained redrive operation row.
     *
     * @param row.id Orchestration job identifier
     * @param row.state pg-boss job state
     * @param row.created_on Creation timestamp
     * @param row.completed_on Terminal completion timestamp, or null
     * @returns Internal redrive operation view
     */
    private toDeadLetterRedrive(row: {
        readonly id: string;
        readonly state: DeadLetterRedrive['state'];
        readonly created_on: Date | string;
        readonly completed_on: Date | string | null;
    }): DeadLetterRedrive {
        return {
            id: row.id,
            state: row.state,
            createdOn: row.created_on instanceof Date ? row.created_on : new Date(row.created_on),
            completedOn:
                row.completed_on === null
                    ? null
                    : row.completed_on instanceof Date
                      ? row.completed_on
                      : new Date(row.completed_on),
        };
    }
}
