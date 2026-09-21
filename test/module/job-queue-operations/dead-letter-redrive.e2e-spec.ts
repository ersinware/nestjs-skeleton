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
import {
    JOB_QUEUE_DEAD_LETTER,
    JOB_QUEUE_DEAD_LETTER_REDRIVE,
    TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT,
    type IJobQueueDeadLetterOperatorPort,
} from 'src/core/job-queue';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { AuditAction, TOKEN_AUDIT_PORT, audit, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_ERROR_REPORTER_PORT } from 'src/core/observability/error-reporter';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { AuthTokenType, TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { Permission, PrincipalType } from 'src/shared/domain/principal';
import { UnauthenticatedException } from 'src/shared/exception';
import request from 'supertest';
import { createTestApp } from 'test/shared/test-app.factory';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Versioned redrive route shared by start and status checks.
 */
const REDRIVE_PATH = '/api/v1/job-operations/dead-letter/redrive';

/**
 * Isolated operator identity for all audit assertions and cleanup.
 */
const ACTOR_ID = randomUUID();

describe('Dead-letter redrive', () => {
    let app: NestFastifyApplication;
    let boss: PgBoss;
    let database: NodePgDatabase;
    let auditPort: IAuditPort;
    let operatorPort: IJobQueueDeadLetterOperatorPort;
    let tokenPort: ITokenPort;
    let sessionPort: ISessionPort;

    /**
     * Only test-owned queues, DLQ copies, and operations are removed.
     */
    const sourceQueues = new Set<string>();
    const deadLetterIds = new Set<string>();
    const operationIds = new Set<string>();

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
     * Starts an operation and captures its identifier for status checks and cleanup.
     *
     * @returns Accepted operation identifier
     */
    async function startRedrive(): Promise<string> {
        const response = await request(app.getHttpServer())
            .post(REDRIVE_PATH)
            .auth('redrive', { type: 'bearer' })
            .expect(202);
        const body = response.body as { data: { operationId: string; status: string } };
        const operationId = body.data.operationId;
        expect(body.data).toStrictEqual({ operationId, status: 'ACCEPTED' });
        operationIds.add(operationId);
        return operationId;
    }

    /**
     * Waits for the real worker to settle without producing disclosure-audit polling records.
     *
     * @param operationId Accepted operation identifier
     * @param state Expected pg-boss lifecycle state
     */
    async function waitForOperation(operationId: string, state: string): Promise<void> {
        await expect
            .poll(async () => (await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id: operationId }))[0]?.state, {
                timeout: 15_000,
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
     * Reads durable redrive request audit for an accepted operation.
     *
     * @param operationId Accepted operation identifier
     * @returns Matching audit records
     */
    async function requestAudit(operationId: string) {
        return database
            .select()
            .from(audit)
            .where(
                and(
                    eq(audit.action, AuditAction.JOB_DEAD_LETTER_REDRIVE_REQUESTED),
                    sql`${audit.detail} ->> 'operationId' = ${operationId}`,
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
        tokenPort = app.get<ITokenPort>(TOKEN_TOKEN_PORT);
        sessionPort = app.get<ISessionPort>(TOKEN_SESSION_PORT);
    });

    beforeEach(() => {
        vi.spyOn(tokenPort, 'verifyAccessToken').mockImplementation((token) => {
            if (token !== 'redrive' && token !== 'read' && token !== 'none') {
                return Promise.reject(new UnauthenticatedException());
            }

            return Promise.resolve({
                sub: ACTOR_ID,
                sid: randomUUID(),
                sessionExpiresAt: Math.floor(Date.now() / 1000) + 3600,
                exp: Math.floor(Date.now() / 1000) + 900,
                principalType: PrincipalType.ADMIN,
                permissions:
                    token === 'redrive'
                        ? [Permission.JOB_DEAD_LETTER_REDRIVE]
                        : token === 'read'
                          ? [Permission.JOB_DEAD_LETTER_READ]
                          : [],
                sessionVersion: 0,
                type: AuthTokenType.ACCESS,
            });
        });
        vi.spyOn(sessionPort, 'isSessionActive').mockResolvedValue(true);
    });

    afterEach(async () => {
        for (const id of operationIds) {
            await boss.deleteJob(JOB_QUEUE_DEAD_LETTER_REDRIVE, id);
        }
        operationIds.clear();

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

    it('commits an exclusive request and audit, then exposes a sanitized completed status', async () => {
        const operationId = await startRedrive();
        await waitForOperation(operationId, 'completed');

        const records = await requestAudit(operationId);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            actorId: ACTOR_ID,
            actorType: PrincipalType.ADMIN,
            detail: { operationId },
        });

        const response = await request(app.getHttpServer())
            .get(`${REDRIVE_PATH}/${operationId}`)
            .auth('read', { type: 'bearer' })
            .expect(200);
        const body = response.body as {
            data: { operationId: string; status: string; createdOn: string; completedOn: string };
        };
        expect(body.data.operationId).toBe(operationId);
        expect(body.data.status).toBe('COMPLETED');
        expect(Number.isNaN(Date.parse(body.data.createdOn))).toBe(false);
        expect(Number.isNaN(Date.parse(body.data.completedOn))).toBe(false);
        expect(Object.keys(body.data).sort()).toStrictEqual(['completedOn', 'createdOn', 'operationId', 'status']);
    });

    it('allows only one queued or running operation and no audit for a rejected request', async () => {
        let release!: (value: number) => void;
        let secondApp: NestFastifyApplication | undefined;
        const heldBatch = new Promise<number>((resolve) => {
            release = resolve;
        });
        vi.spyOn(operatorPort, 'redriveDeadLetterJobs').mockReturnValueOnce(heldBatch);

        try {
            const operationId = await startRedrive();
            await waitForOperation(operationId, 'active');

            secondApp = await createTestApp({
                overrides: [
                    { provide: TOKEN_ERROR_REPORTER_PORT, useValue: { report: vi.fn() } },
                    { provide: TOKEN_TOKEN_PORT, useValue: tokenPort },
                    { provide: TOKEN_SESSION_PORT, useValue: sessionPort },
                ],
            });
            await request(secondApp.getHttpServer()).post(REDRIVE_PATH).auth('redrive', { type: 'bearer' }).expect(409);
            const records = await database
                .select()
                .from(audit)
                .where(
                    and(eq(audit.actorId, ACTOR_ID), eq(audit.action, AuditAction.JOB_DEAD_LETTER_REDRIVE_REQUESTED)),
                );
            expect(records).toHaveLength(1);
        } finally {
            if (secondApp) {
                await secondApp.close();
            }
            release(0);
        }

        const [operationId] = operationIds;
        if (!operationId) {
            throw new Error('The accepted operation ID is missing.');
        }
        await waitForOperation(operationId, 'completed');
    });

    it('rolls back the orchestration job when its audit insert fails', async () => {
        vi.spyOn(auditPort, 'record').mockRejectedValueOnce(new Error('Intentional audit failure.'));

        await request(app.getHttpServer()).post(REDRIVE_PATH).auth('redrive', { type: 'bearer' }).expect(500);

        const operations = await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE);
        expect(operations).toHaveLength(0);
        const records = await database
            .select()
            .from(audit)
            .where(and(eq(audit.actorId, ACTOR_ID), eq(audit.action, AuditAction.JOB_DEAD_LETTER_REDRIVE_REQUESTED)));
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

        const operationId = await startRedrive();
        await waitForOperation(operationId, 'completed');

        expect(await countRedriven(first, firstMarker)).toBe(1);
        expect(await countRedriven(second, secondMarker)).toBe(1);
        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id: firstJob.deadLetterId })).toHaveLength(0);
        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id: secondJob.deadLetterId })).toHaveLength(0);
        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id: orphanJob.deadLetterId })).toHaveLength(1);
        expect((await boss.findJobs(first, { id: firstJob.sourceId }))[0]?.state).toBe('failed');
        expect((await boss.findJobs(second, { id: secondJob.sourceId }))[0]?.state).toBe('failed');
    });

    it('lists and reads real DLQ provenance without exposing the payload or failure output', async () => {
        const source = await createSourceQueue();
        const aggregateId = randomUUID();
        const { sourceId, deadLetterId } = await sendFailed(source, aggregateId);

        const detail = await request(app.getHttpServer())
            .get(`/api/v1/job-operations/dead-letter/jobs/${deadLetterId}`)
            .auth('read', { type: 'bearer' })
            .expect(200);
        const body = detail.body as { data: Record<string, unknown> };
        expect(body.data).toMatchObject({
            id: deadLetterId,
            sourceName: source,
            sourceId,
            sourceRetryCount: 0,
            aggregateId,
        });
        expect(Object.keys(body.data).sort()).toStrictEqual([
            'aggregateId',
            'createdOn',
            'deliveryId',
            'id',
            'sourceCreatedOn',
            'sourceId',
            'sourceName',
            'sourceRetryCount',
        ]);

        const list = await request(app.getHttpServer())
            .get('/api/v1/job-operations/dead-letter/jobs')
            .auth('read', { type: 'bearer' })
            .expect(200);
        const page = list.body as { data: { items: Record<string, unknown>[] } };
        expect(page.data.items).toContainEqual(body.data);
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

        const operationId = await startRedrive();
        await waitForOperation(operationId, 'completed');

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

        const operationId = await startRedrive();
        await waitForOperation(operationId, 'retry');
        await expect
            .poll(async () => (await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id: operationId }))[0]?.state, {
                timeout: 40_000,
                interval: 200,
            })
            .toBe('completed');

        expect(await countRedriven(source, marker)).toBe(2);
        const remaining = await database.execute<{ total: string }>(sql`
            SELECT count(*)::text AS total FROM pgboss.job
            WHERE name = ${JOB_QUEUE_DEAD_LETTER} AND source_name = ${source}
        `);
        expect(Number(remaining.rows[0]?.total)).toBe(0);
    }, 45_000);

    it('enforces permissions and validates status IDs without starting or disclosing an operation', async () => {
        await request(app.getHttpServer()).post(REDRIVE_PATH).expect(401);
        await request(app.getHttpServer()).post(REDRIVE_PATH).auth('read', { type: 'bearer' }).expect(403);
        await request(app.getHttpServer()).post(REDRIVE_PATH).auth('none', { type: 'bearer' }).expect(403);
        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE)).toHaveLength(0);

        await request(app.getHttpServer())
            .get(`${REDRIVE_PATH}/not-a-uuid`)
            .auth('read', { type: 'bearer' })
            .expect(400);
        await request(app.getHttpServer())
            .get(`${REDRIVE_PATH}/${randomUUID()}`)
            .auth('read', { type: 'bearer' })
            .expect(404);

        const operationId = await startRedrive();
        await waitForOperation(operationId, 'completed');
        await request(app.getHttpServer()).get(`${REDRIVE_PATH}/${operationId}`).expect(401);
        await request(app.getHttpServer())
            .get(`${REDRIVE_PATH}/${operationId}`)
            .auth('redrive', { type: 'bearer' })
            .expect(403);
    });
});
