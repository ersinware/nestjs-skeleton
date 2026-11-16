/**
 * @file dead-letter-redrive.e2e-spec.ts
 * @description Verifies redrive HTTP, pg-boss delivery, exclusivity, and transactional audit.
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database';
import { idempotency } from 'src/core/idempotency/idempotency.schema';
import {
    JOB_QUEUE_DEAD_LETTER,
    JOB_QUEUE_DEAD_LETTER_REDRIVE,
    TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT,
    type IJobQueueDeadLetterOperatorPort,
} from 'src/core/job-queue';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { TOKEN_AUDIT_PORT, audit, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_ERROR_REPORTER_PORT } from 'src/core/observability/error-reporter';
import { ACCESS_TOKEN_TYPE, TOKEN_AUTH_ACCESS_TOKEN_PORT } from 'src/core/security/auth';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import type { ITokenPort } from 'src/core/security/token';
import { JobQueueOperationsAuditAction } from 'src/module/job-queue-operations/shared/job-queue-operations-audit';
import { Permission, PrincipalType } from 'src/shared/domain/principal';
import { UnauthenticatedException } from 'src/shared/exception';
import { nowEpochSeconds } from 'src/shared/time';
import request from 'supertest';
import { createTestApp } from 'test/shared/test-app.factory';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Versioned redrive route shared by start and status checks.
 */
const REDRIVE_PATH = '/api/v1/job-operation/dead-letter/redrive';

/**
 * Isolated operator identity for all audit assertions and cleanup.
 */
const ACTOR_ID = randomUUID();

// Allow the production worker's 30-second polling interval plus HTTP and database work.
describe('Dead-letter redrive', { timeout: 45_000 }, () => {
    let app: NestFastifyApplication;
    let boss: PgBoss;
    let database: NodePgDatabase;
    let auditPort: IAuditPort;
    let operatorPort: IJobQueueDeadLetterOperatorPort;
    let tokenPort: ITokenPort<typeof ACCESS_TOKEN_TYPE>;
    let sessionPort: ISessionPort;

    /**
     * Only test-owned queues, DLQ copies, and operations are removed.
     */
    const sourceQueues = new Set<string>();
    const deadLetterIds = new Set<string>();
    const redriveIds = new Set<string>();

    /**
     * Creates a source queue that routes terminal failures into the shared DLQ.
     *
     * @returns Test-owned source queue name
     */
    async function createSourceQueue(): Promise<string> {
        const name = `test.dlq-redrive.${randomUUID()}`;
        await boss.createQueue(name, {
            policy: 'standard',
            partition: false,
            retryLimit: 0,
            deadLetter: JOB_QUEUE_DEAD_LETTER,
        });
        sourceQueues.add(name);
        return name;
    }

    /**
     * Uses pg-boss's failure transition to generate authentic DLQ provenance.
     *
     * @param sourceName Owning source queue
     * @param aggregateId Marker used to count test-owned destination jobs
     * @returns Original ID and generated DLQ copy ID
     */
    async function sendFailed(
        sourceName: string,
        aggregateId: string,
    ): Promise<{ sourceId: string; deadLetterId: string }> {
        const sourceId = await boss.send(sourceName, { deliveryId: randomUUID(), aggregateId });
        if (!sourceId) {
            throw new Error('The source job was not accepted.');
        }

        await boss.fail(sourceName, sourceId, { message: 'Intentional test failure.' });
        const result = await database.execute<{ id: string }>(sql`
            SELECT id FROM pgboss.job
            WHERE name = ${JOB_QUEUE_DEAD_LETTER} AND source_name = ${sourceName} AND source_id = ${sourceId}
        `);
        const deadLetterId = result.rows[0]?.id;
        if (!deadLetterId) {
            throw new Error('The source failure did not produce a dead-letter copy.');
        }

        deadLetterIds.add(deadLetterId);
        return { sourceId, deadLetterId };
    }

    /**
     * Starts an operation and captures its pg-boss identifier for lifecycle assertions and cleanup.
     *
     * @param key Client request identity
     * @returns Accepted operation identifier
     */
    async function startRedrive(key: string = randomUUID()): Promise<string> {
        const before = new Set((await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE)).map((job) => job.id));
        const response = await request(app.getHttpServer())
            .post(REDRIVE_PATH)
            .set('Idempotency-Key', key)
            .auth('redrive', { type: 'bearer' })
            .expect(202);
        expect(response.body).toStrictEqual({ data: null });
        const created = (await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE)).find((job) => !before.has(job.id));
        if (!created) {
            throw new Error('The test redrive operation was not found in pg-boss.');
        }
        redriveIds.add(created.id);
        return created.id;
    }

    /**
     * Waits for the real worker to settle without producing disclosure-audit polling records.
     *
     * @param redriveId Accepted operation identifier
     * @param state Expected pg-boss lifecycle state
     */
    async function waitForOperation(redriveId: string, state: string): Promise<void> {
        await expect
            .poll(async () => (await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id: redriveId }))[0]?.state, {
                timeout: 40_000,
                interval: 100,
            })
            .toBe(state);
    }

    /**
     * Counts newly redriven jobs rather than the retained failed source rows.
     *
     * @param sourceName Source queue to inspect
     * @param aggregateId Test-owned payload marker
     * @returns Number of recreated jobs
     */
    async function countRedriven(sourceName: string, aggregateId: string): Promise<number> {
        const result = await database.execute<{ total: string }>(sql`
            SELECT count(*)::text AS total FROM pgboss.job
            WHERE name = ${sourceName} AND state = 'created' AND data ->> 'aggregateId' = ${aggregateId}
        `);
        return Number(result.rows[0]?.total);
    }

    /**
     * Reads durable redrive request audit for an accepted idempotency.
     *
     * @param redriveId Accepted operation identifier
     * @returns Matching audit records
     */
    async function requestAudit(redriveId: string) {
        return database
            .select()
            .from(audit)
            .where(
                and(
                    eq(audit.action, JobQueueOperationsAuditAction.JOB_DEAD_LETTER_REDRIVE_REQUESTED),
                    sql`${audit.detail} ->> 'redriveId' = ${redriveId}`,
                ),
            );
    }

    beforeAll(async () => {
        app = await createTestApp({
            overrides: [{ provide: TOKEN_ERROR_REPORTER_PORT, useValue: { report: vi.fn() } }],
        });
        boss = app.get<PgBoss>(TOKEN_JOB_QUEUE_CLIENT);
        database = app.get<NodePgDatabase>(TOKEN_DATABASE_CLIENT);
        auditPort = app.get<IAuditPort>(TOKEN_AUDIT_PORT);
        operatorPort = app.get<IJobQueueDeadLetterOperatorPort>(TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT);
        tokenPort = app.get<ITokenPort<typeof ACCESS_TOKEN_TYPE>>(TOKEN_AUTH_ACCESS_TOKEN_PORT);
        sessionPort = app.get<ISessionPort>(TOKEN_SESSION_PORT);
    });

    beforeEach(() => {
        vi.spyOn(tokenPort, 'verify').mockImplementation((token) => {
            if (token !== 'redrive' && token !== 'read' && token !== 'none') {
                return Promise.reject(new UnauthenticatedException());
            }

            return Promise.resolve({
                sub: ACTOR_ID,
                sid: randomUUID(),
                exp: nowEpochSeconds() + 900,
                principalType: PrincipalType.ADMIN,
                permissions:
                    token === 'redrive'
                        ? [Permission.JOB_DEAD_LETTER_REDRIVE]
                        : token === 'read'
                          ? [Permission.JOB_DEAD_LETTER_READ]
                          : [],
                sessionVersion: 0,
                type: ACCESS_TOKEN_TYPE,
            });
        });
        vi.spyOn(sessionPort, 'isSessionActive').mockResolvedValue(true);
    });

    afterEach(async () => {
        for (const id of redriveIds) {
            await boss.deleteJob(JOB_QUEUE_DEAD_LETTER_REDRIVE, id);
        }
        redriveIds.clear();

        for (const id of deadLetterIds) {
            await boss.deleteJob(JOB_QUEUE_DEAD_LETTER, id);
        }
        deadLetterIds.clear();

        for (const name of sourceQueues) {
            await boss.deleteQueue(name);
        }
        sourceQueues.clear();
        await database.delete(audit).where(eq(audit.actorId, ACTOR_ID));
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    it('replays 202 after completion without another orchestration job or request audit', async () => {
        const key = randomUUID();
        try {
            const before = new Set((await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE)).map((job) => job.id));
            const id = await startRedrive(key);
            await waitForOperation(id, 'completed');
            const replay = await request(app.getHttpServer())
                .post(REDRIVE_PATH)
                .set('Idempotency-Key', key)
                .auth('redrive', { type: 'bearer' })
                .expect(202);
            expect(replay.body).toStrictEqual({ data: null });
            const createdAfter = (await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE)).filter(
                (job) => !before.has(job.id),
            );
            expect(createdAfter.map((job) => job.id)).toStrictEqual([id]);
            expect(await requestAudit(id)).toHaveLength(1);
            const retained = await database.select().from(idempotency).where(eq(idempotency.key, key));
            expect(retained).toMatchObject([{ replayResultId: null }]);
            const requests = await database
                .select()
                .from(audit)
                .where(
                    and(
                        eq(audit.actorId, ACTOR_ID),
                        eq(audit.action, JobQueueOperationsAuditAction.JOB_DEAD_LETTER_REDRIVE_REQUESTED),
                    ),
                );
            expect(requests).toHaveLength(1);
        } finally {
            await database.delete(idempotency).where(eq(idempotency.key, key));
        }
    });

    it('commits an exclusive request and audit', async () => {
        const redriveId = await startRedrive();
        await waitForOperation(redriveId, 'completed');

        const records = await requestAudit(redriveId);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            actorId: ACTOR_ID,
            actorType: PrincipalType.ADMIN,
            detail: { redriveId },
        });
    });

    it('allows only one queued or running operation and no audit for a rejected request', async () => {
        let release!: (value: number) => void;
        let secondApp: NestFastifyApplication | undefined;
        const heldBatch = new Promise<number>((resolve) => {
            release = resolve;
        });
        vi.spyOn(operatorPort, 'redriveDeadLetterJobs').mockReturnValueOnce(heldBatch);

        try {
            const redriveId = await startRedrive();
            await waitForOperation(redriveId, 'active');

            secondApp = await createTestApp({
                overrides: [
                    { provide: TOKEN_ERROR_REPORTER_PORT, useValue: { report: vi.fn() } },
                    { provide: TOKEN_AUTH_ACCESS_TOKEN_PORT, useValue: tokenPort },
                    { provide: TOKEN_SESSION_PORT, useValue: sessionPort },
                ],
            });
            await request(secondApp.getHttpServer())
                .post(REDRIVE_PATH)
                .set('Idempotency-Key', randomUUID())
                .auth('redrive', { type: 'bearer' })
                .expect(409);
            const records = await database
                .select()
                .from(audit)
                .where(
                    and(
                        eq(audit.actorId, ACTOR_ID),
                        eq(audit.action, JobQueueOperationsAuditAction.JOB_DEAD_LETTER_REDRIVE_REQUESTED),
                    ),
                );
            expect(records).toHaveLength(1);
        } finally {
            if (secondApp) {
                await secondApp.close();
            }
            release(0);
        }

        const [redriveId] = redriveIds;
        if (!redriveId) {
            throw new Error('The accepted operation ID is missing.');
        }
        await waitForOperation(redriveId, 'completed');
    });

    it('rolls back the orchestration job when its audit insert fails', async () => {
        const before = (await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE)).map((job) => job.id).sort();
        vi.spyOn(auditPort, 'record').mockRejectedValueOnce(new Error('Intentional audit failure.'));

        await request(app.getHttpServer())
            .post(REDRIVE_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('redrive', { type: 'bearer' })
            .expect(500);

        const operations = await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE);
        expect(operations.map((job) => job.id).sort()).toEqual(before);
        const records = await database
            .select()
            .from(audit)
            .where(
                and(
                    eq(audit.actorId, ACTOR_ID),
                    eq(audit.action, JobQueueOperationsAuditAction.JOB_DEAD_LETTER_REDRIVE_REQUESTED),
                ),
            );
        expect(records).toHaveLength(0);
    });

    it('returns failed jobs to each recorded source queue while leaving orphans and historical failures untouched', async () => {
        const first = await createSourceQueue();
        const second = await createSourceQueue();
        const orphan = await createSourceQueue();
        const firstMarker = randomUUID();
        const secondMarker = randomUUID();
        const orphanMarker = randomUUID();
        const firstJob = await sendFailed(first, firstMarker);
        const secondJob = await sendFailed(second, secondMarker);
        const orphanJob = await sendFailed(orphan, orphanMarker);
        await boss.deleteQueue(orphan);
        sourceQueues.delete(orphan);

        const redriveId = await startRedrive();
        await waitForOperation(redriveId, 'completed');

        expect(await countRedriven(first, firstMarker)).toBe(1);
        expect(await countRedriven(second, secondMarker)).toBe(1);
        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id: firstJob.deadLetterId })).toHaveLength(0);
        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id: secondJob.deadLetterId })).toHaveLength(0);
        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id: orphanJob.deadLetterId })).toHaveLength(1);
        expect((await boss.findJobs(first, { id: firstJob.sourceId }))[0]?.state).toBe('failed');
        expect((await boss.findJobs(second, { id: secondJob.sourceId }))[0]?.state).toBe('failed');
    });

    it('lists real DLQ provenance without exposing the payload or failure output', async () => {
        const source = await createSourceQueue();
        const aggregateId = randomUUID();
        const { sourceId, deadLetterId } = await sendFailed(source, aggregateId);

        const list = await request(app.getHttpServer())
            .get('/api/v1/job-operation/dead-letter/job')
            .auth('read', { type: 'bearer' })
            .expect(200);
        const page = list.body as { data: { items: Record<string, unknown>[] } };
        const listed = page.data.items.find((item) => item['id'] === deadLetterId);
        expect(listed).toBeDefined();
        expect(listed).toMatchObject({
            id: deadLetterId,
            sourceName: source,
            sourceId,
            sourceRetryCount: 0,
            aggregateId,
        });
        expect(Object.keys(listed!).sort()).toStrictEqual([
            'aggregateId',
            'createdOn',
            'deliveryId',
            'id',
            'sourceCreatedOn',
            'sourceId',
            'sourceName',
            'sourceRetryCount',
        ]);
    });

    it('drains more than one internal batch without a public limit parameter', async () => {
        const source = await createSourceQueue();
        const marker = randomUUID();
        const jobs = await Promise.all(
            Array.from({ length: 101 }, () => boss.send(source, { deliveryId: randomUUID(), aggregateId: marker })),
        );
        if (jobs.some((id) => !id)) {
            throw new Error('A source job was not accepted.');
        }

        await Promise.all(jobs.map((id) => boss.fail(source, id!, { message: 'Intentional test failure.' })));
        const copies = await database.execute<{ id: string }>(sql`
            SELECT id FROM pgboss.job WHERE name = ${JOB_QUEUE_DEAD_LETTER}
            AND source_name = ${source} AND data ->> 'aggregateId' = ${marker}
        `);
        expect(copies.rows).toHaveLength(101);
        copies.rows.forEach(({ id }) => deadLetterIds.add(id));

        const redriveId = await startRedrive();
        await waitForOperation(redriveId, 'completed');

        expect(await countRedriven(source, marker)).toBe(101);
        const remaining = await database.execute<{ total: string }>(sql`
            SELECT count(*)::text AS total FROM pgboss.job
            WHERE name = ${JOB_QUEUE_DEAD_LETTER} AND source_name = ${source}
        `);
        expect(Number(remaining.rows[0]?.total)).toBe(0);
    });

    it('retries a failed orchestration job and resumes after a committed batch', async () => {
        const source = await createSourceQueue();
        const marker = randomUUID();
        await sendFailed(source, marker);
        await sendFailed(source, marker);
        const original = operatorPort.redriveDeadLetterJobs.bind(operatorPort);
        vi.spyOn(operatorPort, 'redriveDeadLetterJobs').mockImplementationOnce(async () => {
            await original(1);
            throw new Error('Intentional interruption after one committed batch.');
        });

        const redriveId = await startRedrive();
        await waitForOperation(redriveId, 'retry');
        await expect
            .poll(async () => (await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id: redriveId }))[0]?.state, {
                // Allow retry backoff followed by another production polling interval.
                timeout: 70_000,
                interval: 200,
            })
            .toBe('completed');

        expect(await countRedriven(source, marker)).toBe(2);
        const remaining = await database.execute<{ total: string }>(sql`
            SELECT count(*)::text AS total FROM pgboss.job
            WHERE name = ${JOB_QUEUE_DEAD_LETTER} AND source_name = ${source}
        `);
        expect(Number(remaining.rows[0]?.total)).toBe(0);
    }, 120_000);

    it('enforces permissions without starting an operation', async () => {
        const before = (await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE)).map((job) => job.id).sort();
        await request(app.getHttpServer()).post(REDRIVE_PATH).set('Idempotency-Key', randomUUID()).expect(401);
        await request(app.getHttpServer())
            .post(REDRIVE_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('read', { type: 'bearer' })
            .expect(403);
        await request(app.getHttpServer())
            .post(REDRIVE_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('none', { type: 'bearer' })
            .expect(403);
        expect((await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE)).map((job) => job.id).sort()).toEqual(before);
    });
});
