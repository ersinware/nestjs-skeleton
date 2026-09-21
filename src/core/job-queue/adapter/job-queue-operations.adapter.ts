/**
 * @file job-queue-operations.adapter.ts
 * @description Adapts the approved dead-letter operations to the shared pg-boss client.
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { fromDrizzle, type JobWithMetadata, type PgBoss } from 'pg-boss';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import { JOB_QUEUE_DEAD_LETTER, JOB_QUEUE_DEAD_LETTER_REDRIVE } from 'src/core/job-queue/dead-letter-queue.constant';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import {
    type DeadLetterQueueStats,
    type DeadLetterRedriveQueueStats,
    type IJobQueueDeadLetterMetricsPort,
} from 'src/core/job-queue/port/job-queue-dead-letter-metrics.port';
import { type IJobQueueDeadLetterOperatorPort } from 'src/core/job-queue/port/job-queue-dead-letter-operator.port';
import {
    type DeadLetterJob,
    type DeadLetterRedriveOperation,
    type IJobQueueDeadLetterReaderPort,
} from 'src/core/job-queue/port/job-queue-dead-letter-reader.port';
import { SystemException } from 'src/shared/exception';

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
     * Reads a fresh shared dead-letter queue count snapshot.
     *
     * @returns Ready count and capture time
     */
    async getDeadLetterQueueStats(): Promise<DeadLetterQueueStats> {
        try {
            const [stats] = await this.boss.getQueueStats(JOB_QUEUE_DEAD_LETTER, { force: true });

            if (!stats) {
                throw new SystemException('The job queue returned no dead-letter statistics.', {
                    context: { class: this.constructor.name, method: this.getDeadLetterQueueStats.name },
                });
            }

            return { readyCount: stats.readyCount, capturedOn: stats.capturedOn };
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Reads a fresh redrive-operation queue count snapshot.
     *
     * @returns Failed count and capture time
     */
    async getDeadLetterRedriveQueueStats(): Promise<DeadLetterRedriveQueueStats> {
        try {
            const [stats] = await this.boss.getQueueStats(JOB_QUEUE_DEAD_LETTER_REDRIVE, { force: true });

            if (!stats) {
                throw new SystemException('The job queue returned no redrive-operation statistics.', {
                    context: { class: this.constructor.name, method: this.getDeadLetterRedriveQueueStats.name },
                });
            }

            return { failedCount: stats.failedCount, capturedOn: stats.capturedOn };
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
            const acceptedId = await this.boss.send(
                JOB_QUEUE_DEAD_LETTER_REDRIVE,
                {},
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
     * Loads and narrows one shared dead-letter job.
     *
     * @param id Dead-letter job identifier
     * @returns The job view, or null when absent
     */
    async getDeadLetterJob(id: string): Promise<DeadLetterJob | null> {
        try {
            const [job] = await this.boss.findJobs<unknown>(JOB_QUEUE_DEAD_LETTER, { id });

            return !job ? null : this.toDeadLetterJob(job);
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
            const [job] = await this.boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id: operationId });

            return !job
                ? null
                : {
                      id: job.id,
                      state: job.state,
                      createdOn: job.createdOn,
                      completedOn: job.completedOn,
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
     * Removes pg-boss-only fields from a dead-letter job.
     *
     * @param job Persisted pg-boss job
     * @returns Internal dead-letter view
     */
    private toDeadLetterJob(job: JobWithMetadata<unknown>): DeadLetterJob {
        const { sourceName, sourceId, sourceCreatedOn, sourceRetryCount, data } = job;

        if (
            typeof sourceName !== 'string' ||
            typeof sourceId !== 'string' ||
            !(sourceCreatedOn instanceof Date) ||
            Number.isNaN(sourceCreatedOn.getTime()) ||
            typeof sourceRetryCount !== 'number' ||
            !Number.isInteger(sourceRetryCount) ||
            sourceRetryCount < 0 ||
            typeof data !== 'object' ||
            data === null ||
            !('deliveryId' in data) ||
            typeof data.deliveryId !== 'string' ||
            !('aggregateId' in data) ||
            typeof data.aggregateId !== 'string'
        ) {
            throw new SystemException('The dead-letter job has invalid provenance or identifiers.', {
                context: { class: this.constructor.name, method: this.toDeadLetterJob.name },
            });
        }

        return {
            id: job.id,
            createdOn: job.createdOn,
            sourceName,
            sourceId,
            sourceCreatedOn,
            sourceRetryCount,
            deliveryId: data.deliveryId,
            aggregateId: data.aggregateId,
        };
    }
}
