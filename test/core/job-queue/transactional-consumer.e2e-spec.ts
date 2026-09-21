/**
 * @file transactional-consumer.e2e-spec.ts
 * @description Verifies atomic commit and rollback for transactional pg-boss consumers.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PgBoss } from 'pg-boss';
import { resolveEnvFilePath, validateConfig } from 'src/core/config';
import {
    DatabaseModule,
    TOKEN_DATABASE_CLIENT,
    TOKEN_TRANSACTION_PORT,
    type ITransactionPort,
} from 'src/core/database';
import {
    JOB_QUEUE_DEAD_LETTER,
    JOB_QUEUE_DEAD_LETTER_REDRIVE,
    JobQueueModule,
    type IJobConsumer,
    type Job,
} from 'src/core/job-queue';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { TOKEN_JOB_QUEUE_WRITER_PORT, type IJobQueueWriterPort } from 'src/core/job-queue/port/job-queue-writer.port';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Queue consumed inside the pg-boss transaction.
 */
const PROBE_QUEUE = 'test.transactional-consumer.probe.queue.v1';

/**
 * Queue receiving jobs from the probe transaction.
 */
const CHILD_QUEUE = 'test.transactional-consumer.child.queue.v1';

/**
 * Aggregate identifier that triggers probe rollback.
 */
const FAILURE_AGGREGATE_ID = 'fail-after-inner-transaction';

/**
 * Exercises application writes and child jobs inside a transactional worker.
 */
@Injectable()
class TransactionalProbeConsumer implements IJobConsumer {
    /**
     * Queue handled by the probe.
     */
    readonly name = PROBE_QUEUE;

    /**
     * Runs probe effects and job completion in one transaction.
     */
    readonly transactional = true;

    /**
     * Initializes the probe with the transaction-aware dependencies under test.
     *
     * @param db Primary database proxy that must select the pg-boss transaction
     * @param transactionPort Nested application transaction boundary that must join the ambient transaction
     * @param jobQueueWriterPort Child-job writer that must enqueue through the same transaction
     */
    constructor(
        @Inject(TOKEN_DATABASE_CLIENT) private readonly db: NodePgDatabase,
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_JOB_QUEUE_WRITER_PORT) private readonly jobQueueWriterPort: IJobQueueWriterPort,
    ) {}

    /**
     * Persists one probe row and one child job, then optionally fails the outer worker transaction.
     *
     * @param job Probe job
     */
    async consume(job: Job) {
        await this.transactionPort.run(async () => {
            await this.db.execute(sql`
                INSERT INTO public.job_queue_transaction_probe (id)
                VALUES (${job.deliveryId})
            `);
            await this.jobQueueWriterPort.enqueue([
                {
                    deliveryId: job.deliveryId,
                    aggregateId: job.aggregateId,
                    queueName: CHILD_QUEUE,
                },
            ]);
        });

        if (job.aggregateId === FAILURE_AGGREGATE_ID) {
            throw new Error('Intentional transactional consumer failure.');
        }
    }
}

describe('Transactional pg-boss consumer', () => {
    let module: TestingModule;
    let boss: PgBoss;
    let db: NodePgDatabase;

    /**
     * Captures intentional consumer failures.
     */
    const report = vi.fn();

    /**
     * Prevents intentional failures from reaching external telemetry.
     */
    const errorReporterPort: IErrorReporterPort = {
        report,
    };

    beforeAll(async () => {
        const builder = Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({
                    isGlobal: true,
                    envFilePath: resolveEnvFilePath(),
                    validate: validateConfig,
                }),
                DatabaseModule,
                JobQueueModule,
                JobQueueModule.forFeature([TransactionalProbeConsumer], [DatabaseModule, JobQueueModule]),
            ],
        });

        builder.overrideProvider(TOKEN_ERROR_REPORTER_PORT).useValue(errorReporterPort);
        module = await builder.compile();
        boss = module.get<PgBoss>(TOKEN_JOB_QUEUE_CLIENT);
        db = module.get<NodePgDatabase>(TOKEN_DATABASE_CLIENT);

        await boss.deleteQueue(PROBE_QUEUE);
        await boss.deleteQueue(CHILD_QUEUE);
        await boss.createQueue(CHILD_QUEUE, { policy: 'standard' });
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS public.job_queue_transaction_probe (
                id text PRIMARY KEY
            )
        `);
        await db.execute(sql`TRUNCATE TABLE public.job_queue_transaction_probe`);

        await module.init();
    });

    afterAll(async () => {
        if (!boss || !db || !module) {
            return;
        }

        await boss.offWork(PROBE_QUEUE);
        await boss.deleteQueue(PROBE_QUEUE);
        await boss.deleteQueue(CHILD_QUEUE);
        await db.execute(sql`DROP TABLE public.job_queue_transaction_probe`);
        await module.close();
    });

    it('rolls application writes and child jobs back before retrying a failed job', async () => {
        const deliveryId = '00000000-0000-7000-8000-000000000001';
        const jobId = await boss.send(PROBE_QUEUE, { deliveryId, aggregateId: FAILURE_AGGREGATE_ID });

        expect(jobId).not.toBeNull();
        await expect
            .poll(async () => (await boss.findJobs(PROBE_QUEUE, { id: jobId! }))[0]?.state, {
                timeout: 10_000,
                interval: 100,
            })
            .toBe('retry');

        const rows = await db.execute<{ id: string }>(sql`
            SELECT id FROM public.job_queue_transaction_probe WHERE id = ${deliveryId}
        `);
        const childJobs = await boss.findJobs<Job>(CHILD_QUEUE);

        expect(rows.rows).toHaveLength(0);
        expect(childJobs.some((job) => job.data.deliveryId === deliveryId)).toBe(false);
        expect(report).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Intentional transactional consumer failure.' }),
            expect.objectContaining({ class: 'JobQueueFeatureModule', method: 'boss.work' }),
        );
    });

    it('commits application writes, child jobs, and job completion together', async () => {
        const deliveryId = '00000000-0000-7000-8000-000000000002';
        const jobId = await boss.send(PROBE_QUEUE, { deliveryId, aggregateId: 'successful-consumer' });

        expect(jobId).not.toBeNull();
        await expect
            .poll(async () => (await boss.findJobs(PROBE_QUEUE, { id: jobId! }))[0]?.state, {
                timeout: 10_000,
                interval: 100,
            })
            .toBe('completed');

        const rows = await db.execute<{ id: string }>(sql`
            SELECT id FROM public.job_queue_transaction_probe WHERE id = ${deliveryId}
        `);
        const childJobs = await boss.findJobs<Job>(CHILD_QUEUE);

        expect(rows.rows).toStrictEqual([{ id: deliveryId }]);
        expect(childJobs.some((job) => job.data.deliveryId === deliveryId)).toBe(true);
    });

    it('routes an exhausted source job into the shared DLQ with provenance and no committed effects', async () => {
        const deliveryId = '00000000-0000-7000-8000-000000000003';
        const jobId = await boss.send(
            PROBE_QUEUE,
            { deliveryId, aggregateId: FAILURE_AGGREGATE_ID },
            { retryLimit: 0 },
        );

        expect(jobId).not.toBeNull();
        try {
            await expect
                .poll(async () => (await boss.findJobs(PROBE_QUEUE, { id: jobId! }))[0]?.state, {
                    timeout: 10_000,
                    interval: 100,
                })
                .toBe('failed');

            const copies = (await boss.findJobs<Job>(JOB_QUEUE_DEAD_LETTER)).filter((job) => job.sourceId === jobId);
            expect(copies).toHaveLength(1);
            expect(copies[0]?.sourceCreatedOn).toBeInstanceOf(Date);
            expect(copies[0]).toMatchObject({
                state: 'created',
                sourceName: PROBE_QUEUE,
                sourceId: jobId,
                sourceRetryCount: 0,
                data: { deliveryId, aggregateId: FAILURE_AGGREGATE_ID },
            });
            const rows = await db.execute(sql`
                SELECT id FROM public.job_queue_transaction_probe WHERE id = ${deliveryId}
            `);
            expect(rows.rows).toHaveLength(0);
            expect((await boss.findJobs<Job>(CHILD_QUEUE)).some((job) => job.data.deliveryId === deliveryId)).toBe(
                false,
            );

            const redriveQueue = await boss.getQueue(JOB_QUEUE_DEAD_LETTER_REDRIVE);
            expect(redriveQueue?.policy).toBe('exclusive');
            expect(redriveQueue?.deadLetter ?? null).toBeNull();
        } finally {
            const copies = (await boss.findJobs<Job>(JOB_QUEUE_DEAD_LETTER)).filter((job) => job.sourceId === jobId);
            if (copies.length > 0) {
                await boss.deleteJob(
                    JOB_QUEUE_DEAD_LETTER,
                    copies.map((job) => job.id),
                );
            }
        }
    });
});
