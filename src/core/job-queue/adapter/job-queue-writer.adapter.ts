/**
 * @file job-queue-writer.adapter.ts
 * @description Persists aggregate jobs through pg-boss using the ambient database transaction.
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { Job } from 'src/core/job-queue/job.type';
import { IJobQueueWriterPort } from 'src/core/job-queue/port/job-queue-writer.port';
import type { JobDefinition } from 'src/shared/domain/job';
import { SystemException } from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

/**
 * Enqueues durable jobs atomically with the aggregate write when a transaction is active.
 */
@Injectable()
export class JobQueueWriterAdapter implements IJobQueueWriterPort {
    /**
     * Initializes the adapter with the required queue dependencies.
     *
     * @param db Primary database executor
     * @param boss pg-boss client used to insert jobs
     */
    constructor(
        @Inject(TOKEN_DATABASE_CLIENT) private readonly db: NodePgDatabase,
        @Inject(TOKEN_JOB_QUEUE_CLIENT) private readonly boss: PgBoss,
    ) {}

    /**
     * Groups jobs by queue and inserts every group through the current database executor.
     *
     * @param jobs Jobs to enqueue
     */
    async enqueue(jobs: readonly JobDefinition[]) {
        if (jobs.length === 0) {
            return;
        }

        const queues = new Map<string, Job[]>();
        for (const job of jobs) {
            const { queueName, ...rest } = job,
                queue = queues.get(queueName) ?? [];

            queue.push(rest);
            queues.set(queueName, queue);
        }

        try {
            for (const [queueName, jobs] of queues.entries()) {
                const jobIds = await this.boss.insert(
                    queueName,
                    jobs.map((job) => ({ id: uuidv7(), data: job })),
                    { db: fromDrizzle(this.db, sql), returnId: true },
                );

                if (jobIds === null || jobIds.length !== jobs.length) {
                    throw new SystemException('The jobs were not all accepted by the queue.', {
                        context: { class: this.constructor.name, method: this.enqueue.name },
                    });
                }
            }
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }
}
