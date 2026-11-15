/**
 * @file job-queue-dead-letter-operator.adapter.ts
 * @description Adapts dead-letter discard and redrive mutations to the shared pg-boss client.
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import { JOB_QUEUE_DEAD_LETTER, JOB_QUEUE_DEAD_LETTER_REDRIVE } from 'src/core/job-queue/dead-letter-queue.constant';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { captureJobTraceparent, runInJobProducerSpan } from 'src/core/job-queue/job-trace-context';
import {
    RedriveDiscardOutcome,
    type IJobQueueDeadLetterOperatorPort,
} from 'src/core/job-queue/port/job-queue-dead-letter-operator.port';
import { SystemException } from 'src/shared/exception';

/**
 * Provides dead-letter mutation operations without exposing the raw pg-boss client.
 */
@Injectable()
export class JobQueueDeadLetterOperatorAdapter implements IJobQueueDeadLetterOperatorPort {
    /**
     * Initializes the writer with the primary database executor and shared queue client.
     *
     * @param database Primary database executor
     * @param boss Shared pg-boss client
     */
    constructor(
        @Inject(TOKEN_DATABASE_CLIENT) private readonly database: NodePgDatabase,
        @Inject(TOKEN_JOB_QUEUE_CLIENT) private readonly boss: PgBoss,
    ) {}

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
     * @param id Caller-generated redrive identifier
     * @returns Whether pg-boss accepted the operation
     */
    async enqueueDeadLetterRedrive(id: string): Promise<boolean> {
        try {
            return await runInJobProducerSpan(JOB_QUEUE_DEAD_LETTER_REDRIVE, async () => {
                const traceparent = captureJobTraceparent(),
                    acceptedId = await this.boss.send(
                        JOB_QUEUE_DEAD_LETTER_REDRIVE,
                        traceparent === undefined ? {} : { traceparent },
                        {
                            id,
                            db: fromDrizzle(this.database, sql),
                        },
                    );

                return acceptedId !== null;
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
     * Atomically deletes exact terminally failed redrive operations through the ambient transaction.
     *
     * @param ids Redrive orchestration job identifiers
     * @returns Outcome indicating deletion, absence, or a non-failed state
     */
    async discardFailedDeadLetterRedrives(ids: readonly string[]): Promise<RedriveDiscardOutcome> {
        try {
            const data = await this.database.execute<{ id: string; state: string }>(sql`
                    SELECT id, state FROM pgboss.job
                    WHERE name = ${JOB_QUEUE_DEAD_LETTER_REDRIVE}
                      AND id IN (${sql.join(
                          ids.map((id) => sql`${id}`),
                          sql`, `,
                      )})
                `);

            if (data.rows.length !== ids.length) {
                return RedriveDiscardOutcome.NOT_FOUND;
            }

            if (data.rows.some((row) => row.state !== 'failed')) {
                return RedriveDiscardOutcome.NOT_FAILED;
            }

            const result: unknown = await this.boss.deleteJob(JOB_QUEUE_DEAD_LETTER_REDRIVE, [...ids], {
                db: fromDrizzle(this.database, sql),
            });

            if (!this.isMutationResult(result)) {
                throw new SystemException('The job queue returned an invalid redrive discard result.', {
                    context: {
                        class: this.constructor.name,
                        method: this.discardFailedDeadLetterRedrives.name,
                    },
                });
            }

            if (result.affected < ids.length) {
                return RedriveDiscardOutcome.NOT_FOUND;
            }

            if (result.affected !== ids.length) {
                throw new SystemException('The job queue deleted an unexpected number of redrives.', {
                    context: {
                        class: this.constructor.name,
                        method: this.discardFailedDeadLetterRedrives.name,
                    },
                });
            }

            return RedriveDiscardOutcome.DISCARDED;
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
}
