/**
 * @file dead-letter-read.e2e-spec.ts
 * @description Verifies paginated DLQ reads, persisted-data masking, and database-backed metrics.
 */

import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { ENV } from 'src/core/config';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database';
import {
    JOB_QUEUE_DEAD_LETTER,
    JOB_QUEUE_DEAD_LETTER_REDRIVE,
    TOKEN_JOB_QUEUE_DEAD_LETTER_METRICS_PORT,
    type IJobQueueDeadLetterMetricsPort,
} from 'src/core/job-queue';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { audit } from 'src/core/observability/audit';
import { TOKEN_ERROR_REPORTER_PORT } from 'src/core/observability/error-reporter';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { AuthTokenType, TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { Permission, PrincipalType } from 'src/shared/domain/principal';
import { UnauthenticatedException } from 'src/shared/exception';
import request from 'supertest';
import { createTestApp } from 'test/shared/test-app.factory';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Versioned route containing the operator-only DLQ job views.
 */
const JOBS_PATH = '/api/v1/job-operations/dead-letter/jobs';

/**
 * Test-owned actor used to remove disclosure audit rows after each case.
 */
const ACTOR_ID = randomUUID();

/**
 * Source queue isolated from other integration suites.
 */
const SOURCE_QUEUE = `test.dlq-read.${randomUUID()}`;

describe('Dead-letter reads and metrics', () => {
    let app: NestFastifyApplication;
    let boss: PgBoss;
    let database: NodePgDatabase;
    let metricsPort: IJobQueueDeadLetterMetricsPort;
    let tokenPort: ITokenPort;
    let sessionPort: ISessionPort;

    /**
     * Tracks only copies created by this suite for exact cleanup.
     */
    const deadLetterIds = new Set<string>();

    /**
     * Tracks failed orchestration jobs created only for metric verification.
     */
    const operationIds = new Set<string>();

    /**
     * Fails a real source job so pg-boss supplies authentic DLQ provenance.
     *
     * @returns The generated DLQ copy identifier
     */
    async function createDeadLetterJob(): Promise<string> {
        const sourceId = await boss.send(SOURCE_QUEUE, {
            deliveryId: randomUUID(),
            aggregateId: randomUUID(),
            secret: 'payload-must-not-appear',
        });
        if (!sourceId) {
            throw new Error('The source job was not accepted.');
        }

        await boss.fail(SOURCE_QUEUE, sourceId, { secret: 'failure-must-not-appear' });
        const result = await database.execute<{ id: string }>(sql`
            SELECT id FROM pgboss.job
            WHERE name = ${JOB_QUEUE_DEAD_LETTER} AND source_name = ${SOURCE_QUEUE} AND source_id = ${sourceId}
        `);
        const id = result.rows[0]?.id;
        if (!id) {
            throw new Error('The source failure did not produce a dead-letter copy.');
        }

        deadLetterIds.add(id);
        return id;
    }

    beforeAll(async () => {
        app = await createTestApp({
            overrides: [{ provide: TOKEN_ERROR_REPORTER_PORT, useValue: { report: vi.fn() } }],
        });
        boss = app.get<PgBoss>(TOKEN_JOB_QUEUE_CLIENT);
        database = app.get<NodePgDatabase>(TOKEN_DATABASE_CLIENT);
        metricsPort = app.get<IJobQueueDeadLetterMetricsPort>(TOKEN_JOB_QUEUE_DEAD_LETTER_METRICS_PORT);
        tokenPort = app.get<ITokenPort>(TOKEN_TOKEN_PORT);
        sessionPort = app.get<ISessionPort>(TOKEN_SESSION_PORT);
        await boss.createQueue(SOURCE_QUEUE, {
            policy: 'standard',
            partition: false,
            retryLimit: 0,
            deadLetter: JOB_QUEUE_DEAD_LETTER,
        });
    });

    beforeEach(() => {
        vi.spyOn(tokenPort, 'verifyAccessToken').mockImplementation((token) => {
            if (token !== 'read' && token !== 'none') {
                return Promise.reject(new UnauthenticatedException());
            }

            return Promise.resolve({
                sub: ACTOR_ID,
                sid: randomUUID(),
                sessionExpiresAt: Math.floor(Date.now() / 1000) + 3600,
                exp: Math.floor(Date.now() / 1000) + 900,
                principalType: PrincipalType.ADMIN,
                permissions: token === 'read' ? [Permission.JOB_DEAD_LETTER_READ] : [],
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
        await database.delete(audit).where(eq(audit.actorId, ACTOR_ID));
    });

    afterAll(async () => {
        if (boss) {
            await boss.deleteQueue(SOURCE_QUEUE);
        }
        if (app) {
            await app.close();
        }
    });

    it('returns bounded newest-first pages and sanitized detail without raw payload or output', async () => {
        const count = await database.execute<{ total: string }>(sql`
            SELECT count(*)::text AS total FROM pgboss.job WHERE name = ${JOB_QUEUE_DEAD_LETTER}
        `);
        const baseline = Number(count.rows[0]?.total);
        const ids = [await createDeadLetterJob(), await createDeadLetterJob(), await createDeadLetterJob()] as const;
        for (const [index, id] of ids.entries()) {
            await database.execute(sql`
                UPDATE pgboss.job SET created_on = now() + ${3 - index} * interval '1 minute'
                WHERE name = ${JOB_QUEUE_DEAD_LETTER} AND id = ${id}
            `);
        }

        const first = await request(app.getHttpServer())
            .get(`${JOBS_PATH}?page=1&limit=2`)
            .auth('read', { type: 'bearer' })
            .expect(200);
        const second = await request(app.getHttpServer())
            .get(`${JOBS_PATH}?page=2&limit=2`)
            .auth('read', { type: 'bearer' })
            .expect(200);
        const firstPage = first.body as {
            data: { items: { id: string }[]; total: number; page: number; limit: number };
        };
        const secondPage = second.body as {
            data: { items: { id: string }[]; total: number; page: number; limit: number };
        };
        expect(firstPage.data.items.map(({ id }) => id)).toStrictEqual(ids.slice(0, 2));
        expect(secondPage.data.items[0]?.id).toBe(ids[2]);
        expect(firstPage.data).toMatchObject({ total: baseline + 3, page: 1, limit: 2 });
        expect(secondPage.data).toMatchObject({ total: baseline + 3, page: 2, limit: 2 });
        expect(JSON.stringify(first.body)).not.toContain('payload-must-not-appear');
        expect(JSON.stringify(first.body)).not.toContain('failure-must-not-appear');
        expect((await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id: ids[0] }))[0]?.state).toBe('created');

        const detail = await request(app.getHttpServer())
            .get(`${JOBS_PATH}/${ids[0]}`)
            .auth('read', { type: 'bearer' })
            .expect(200);
        const body = JSON.stringify(detail.body);
        expect(body).not.toContain('payload-must-not-appear');
        expect(body).not.toContain('failure-must-not-appear');
        expect(Object.keys((detail.body as { data: Record<string, unknown> }).data).sort()).toStrictEqual([
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

    it('masks invalid persisted provenance in both detail and list responses', async () => {
        const id = await createDeadLetterJob();
        for (const mutation of [
            sql`UPDATE pgboss.job SET source_name = NULL WHERE name = ${JOB_QUEUE_DEAD_LETTER} AND id = ${id}`,
            sql`UPDATE pgboss.job SET source_name = ${SOURCE_QUEUE}, source_created_on = NULL
                WHERE name = ${JOB_QUEUE_DEAD_LETTER} AND id = ${id}`,
            sql`UPDATE pgboss.job SET source_created_on = now(),
                    data = jsonb_set(data, '{aggregateId}', '"invalid-uuid"'::jsonb)
                WHERE name = ${JOB_QUEUE_DEAD_LETTER} AND id = ${id}`,
        ]) {
            await database.execute(mutation);

            for (const path of [`${JOBS_PATH}/${id}`, JOBS_PATH]) {
                const response = await request(app.getHttpServer())
                    .get(path)
                    .auth('read', { type: 'bearer' })
                    .expect(500);
                const body = JSON.stringify(response.body);
                expect(body).not.toContain('payload-must-not-appear');
                expect(body).not.toContain('failure-must-not-appear');
                expect(body).not.toContain('source_name');
                expect(body).not.toContain('invalid-uuid');
            }
        }
    });

    it('requires authentication and the read permission for list and detail', async () => {
        const id = await createDeadLetterJob();
        for (const path of [JOBS_PATH, `${JOBS_PATH}/${id}`]) {
            await request(app.getHttpServer()).get(path).expect(401);
            await request(app.getHttpServer()).get(path).auth('none', { type: 'bearer' }).expect(403);
        }
        await request(app.getHttpServer()).get(`${JOBS_PATH}/not-a-uuid`).auth('read', { type: 'bearer' }).expect(400);
        await request(app.getHttpServer())
            .get(`${JOBS_PATH}/${randomUUID()}`)
            .auth('read', { type: 'bearer' })
            .expect(404);
    });

    it('keeps liveness and readiness healthy while a dead-letter job awaits an operator', async () => {
        const config = app.get(ConfigService);
        const heapLimit = config.getOrThrow<number>(ENV.HEALTH_HEAP_LIMIT_MB);
        const rssLimit = config.getOrThrow<number>(ENV.HEALTH_RSS_LIMIT_MB);
        // The Vitest runner itself can exceed the application memory thresholds.
        config.set(ENV.HEALTH_HEAP_LIMIT_MB, 4_096);
        config.set(ENV.HEALTH_RSS_LIMIT_MB, 4_096);

        try {
            await request(app.getHttpServer()).get('/api/health/ready').expect(204);
            const id = await createDeadLetterJob();
            expect((await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id }))[0]?.state).toBe('created');

            await request(app.getHttpServer()).get('/api/health/live').expect(204);
            await request(app.getHttpServer()).get('/api/health/ready').expect(204);
        } finally {
            config.set(ENV.HEALTH_HEAP_LIMIT_MB, heapLimit);
            config.set(ENV.HEALTH_RSS_LIMIT_MB, rssLimit);
        }
    });

    it('reads live ready count and oldest creation time from pg-boss state', async () => {
        // The queue-table stats cache can lag persisted jobs for up to one minute even with force:true.
        await database.execute(sql`
            UPDATE pgboss.queue SET monitor_on = NULL WHERE name = ${JOB_QUEUE_DEAD_LETTER}
        `);
        const readyBefore = await metricsPort.getDeadLetterReadyCount();
        const id = await createDeadLetterJob();
        // pg-boss may reuse a forced stats snapshot for one minute; expire only this test queue's cache.
        await database.execute(sql`
            UPDATE pgboss.queue SET monitor_on = NULL WHERE name = ${JOB_QUEUE_DEAD_LETTER}
        `);
        const row = await database.execute<{ created_on: string }>(sql`
            SELECT created_on FROM pgboss.job WHERE name = ${JOB_QUEUE_DEAD_LETTER} AND id = ${id}
        `);
        const createdOn = row.rows[0]?.created_on;
        if (!createdOn) {
            throw new Error('The dead-letter job creation time is missing.');
        }

        expect(await metricsPort.getDeadLetterReadyCount()).toBe(readyBefore + 1);
        expect((await metricsPort.getOldestDeadLetterCreatedOn())?.getTime()).toBeLessThanOrEqual(
            Date.parse(createdOn),
        );

        await boss.deleteJob(JOB_QUEUE_DEAD_LETTER, id);
        deadLetterIds.delete(id);
        await database.execute(sql`
            UPDATE pgboss.queue SET monitor_on = NULL WHERE name = ${JOB_QUEUE_DEAD_LETTER}
        `);
        expect(await metricsPort.getDeadLetterReadyCount()).toBe(readyBefore);
    });

    it('counts retained terminal redrive failures without moving them into the DLQ', async () => {
        await database.execute(sql`
            UPDATE pgboss.queue SET monitor_on = NULL WHERE name = ${JOB_QUEUE_DEAD_LETTER_REDRIVE}
        `);
        const failedBefore = await metricsPort.getDeadLetterRedriveFailedCount();
        const operationId = await boss.send(
            JOB_QUEUE_DEAD_LETTER_REDRIVE,
            {},
            { retryLimit: 0, startAfter: new Date(Date.now() + 3_600_000) },
        );
        if (!operationId) {
            throw new Error('The test redrive operation was not accepted.');
        }
        operationIds.add(operationId);
        await boss.fail(JOB_QUEUE_DEAD_LETTER_REDRIVE, operationId, { message: 'Intentional test failure.' });
        await database.execute(sql`
            UPDATE pgboss.queue SET monitor_on = NULL WHERE name = ${JOB_QUEUE_DEAD_LETTER_REDRIVE}
        `);

        expect((await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id: operationId }))[0]?.state).toBe('failed');
        expect(await metricsPort.getDeadLetterRedriveFailedCount()).toBe(failedBefore + 1);
        const status = await request(app.getHttpServer())
            .get(`/api/v1/job-operations/dead-letter/redrive/${operationId}`)
            .auth('read', { type: 'bearer' })
            .expect(200);
        expect((status.body as { data: { status: string } }).data.status).toBe('FAILED');
        expect(JSON.stringify(status.body)).not.toContain('Intentional test failure.');
        const copies = await database.execute<{ total: string }>(sql`
            SELECT count(*)::text AS total FROM pgboss.job
            WHERE name = ${JOB_QUEUE_DEAD_LETTER} AND source_id = ${operationId}
        `);
        expect(Number(copies.rows[0]?.total)).toBe(0);
    });

    it('returns a cancelled orchestration operation without exposing pg-boss output', async () => {
        const operationId = await boss.send(
            JOB_QUEUE_DEAD_LETTER_REDRIVE,
            {},
            { startAfter: new Date(Date.now() + 3_600_000) },
        );
        if (!operationId) {
            throw new Error('The test redrive operation was not accepted.');
        }
        operationIds.add(operationId);
        await boss.cancel(JOB_QUEUE_DEAD_LETTER_REDRIVE, operationId);

        const response = await request(app.getHttpServer())
            .get(`/api/v1/job-operations/dead-letter/redrive/${operationId}`)
            .auth('read', { type: 'bearer' })
            .expect(200);
        expect((response.body as { data: { status: string } }).data.status).toBe('CANCELLED');
        expect(Object.keys((response.body as { data: Record<string, unknown> }).data).sort()).toStrictEqual([
            'completedOn',
            'createdOn',
            'operationId',
            'status',
        ]);
    });
});
