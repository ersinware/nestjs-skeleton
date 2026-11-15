/**
 * @file dead-letter-redrive-discard.e2e-spec.ts
 * @description Verifies exact failed dead-letter redrive discard through HTTP, pg-boss, and transactional audit.
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database';
import { operation } from 'src/core/idempotency/idempotency.schema';
import { JOB_QUEUE_DEAD_LETTER, JOB_QUEUE_DEAD_LETTER_REDRIVE } from 'src/core/job-queue';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { TOKEN_AUDIT_PORT, audit, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_ERROR_REPORTER_PORT } from 'src/core/observability/error-reporter';
import { ACCESS_TOKEN_TYPE, TOKEN_AUTH_ACCESS_TOKEN_PORT, type AccessTokenPayload } from 'src/core/security/auth';
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
 * Route under the production versioned API prefix.
 */
const DISCARD_REDRIVE_PATH = '/api/v1/job-operation/dead-letter/redrive/discard';

/**
 * Unique operator identity keeps test audit rows separate from other suites.
 */
const ACTOR_ID = randomUUID();

describe('Dead-letter redrive discard', () => {
    let app: NestFastifyApplication;
    let boss: PgBoss;
    let database: NodePgDatabase;
    let auditPort: IAuditPort;
    let tokenPort: ITokenPort<typeof ACCESS_TOKEN_TYPE>;
    let sessionPort: ISessionPort;

    /**
     * Test-owned jobs are removed even when a test assertion fails.
     */
    const trackedJobs = new Map<string, string>();

    /**
     * Creates a redrive orchestration job in the requested pg-boss state without triggering the worker.
     *
     * @param state Target pg-boss state
     * @returns Persisted pg-boss job identifier
     */
    async function createRedriveJob(state: 'created' | 'completed' | 'failed' | 'cancelled'): Promise<string> {
        const id = await boss.send(
            JOB_QUEUE_DEAD_LETTER_REDRIVE,
            {},
            { retryLimit: 0, startAfter: new Date(Date.now() + 3_600_000) },
        );
        if (!id) {
            throw new Error('The test redrive job was not accepted.');
        }

        trackedJobs.set(id, JOB_QUEUE_DEAD_LETTER_REDRIVE);

        if (state === 'failed') {
            await boss.fail(JOB_QUEUE_DEAD_LETTER_REDRIVE, id, { message: 'Intentional test failure.' });
        } else if (state === 'completed') {
            // pg-boss complete() requires an active job; mark completed directly to avoid worker races.
            await database.execute(sql`
                UPDATE pgboss.job
                SET state = 'completed', completed_on = now()
                WHERE name = ${JOB_QUEUE_DEAD_LETTER_REDRIVE} AND id = ${id}
            `);
        } else if (state === 'cancelled') {
            await boss.cancel(JOB_QUEUE_DEAD_LETTER_REDRIVE, id);
        }

        return id;
    }

    /**
     * Reads only redrive discard audit evidence associated with one test-owned job.
     *
     * @param redriveId Redrive job identifier present in the audit detail
     * @returns Matching audit rows
     */
    async function discardAudit(redriveId: string) {
        return database
            .select()
            .from(audit)
            .where(
                and(
                    eq(audit.action, JobQueueOperationsAuditAction.JOB_DEAD_LETTER_REDRIVE_DISCARDED),
                    sql`${audit.detail} -> 'ids' @> ${JSON.stringify([redriveId])}::jsonb`,
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
        tokenPort = app.get<ITokenPort<typeof ACCESS_TOKEN_TYPE>>(TOKEN_AUTH_ACCESS_TOKEN_PORT);
        sessionPort = app.get<ISessionPort>(TOKEN_SESSION_PORT);
    });

    beforeEach(() => {
        vi.spyOn(tokenPort, 'verify').mockImplementation((token) => {
            if (token !== 'discard' && token !== 'read' && token !== 'redrive' && token !== 'none') {
                return Promise.reject(new UnauthenticatedException());
            }

            return Promise.resolve({
                sub: ACTOR_ID,
                sid: randomUUID(),
                exp: nowEpochSeconds() + 900,
                principalType: PrincipalType.ADMIN,
                permissions:
                    token === 'discard'
                        ? [Permission.JOB_DEAD_LETTER_DISCARD]
                        : token === 'read'
                          ? [Permission.JOB_DEAD_LETTER_READ]
                          : token === 'redrive'
                            ? [Permission.JOB_DEAD_LETTER_REDRIVE]
                            : [],
                sessionVersion: 0,
                type: ACCESS_TOKEN_TYPE,
            });
        });
        vi.spyOn(sessionPort, 'isSessionActive').mockResolvedValue(true);
    });

    afterEach(async () => {
        for (const [id, queue] of trackedJobs) {
            await boss.deleteJob(queue, id);
        }
        trackedJobs.clear();
        await database.delete(audit).where(eq(audit.actorId, ACTOR_ID));
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    it('replays a bulk 204 after a lost response, accepts reordered IDs, and rejects changed selection', async () => {
        const ids = [await createRedriveJob('failed'), await createRedriveJob('failed')];
        const untouched = await createRedriveJob('failed');
        const key = randomUUID();
        try {
            for (const orderedIds of [ids, [...ids].reverse()]) {
                await request(app.getHttpServer())
                    .post(DISCARD_REDRIVE_PATH)
                    .set('Idempotency-Key', key)
                    .auth('discard', { type: 'bearer' })
                    .send({ ids: orderedIds })
                    .expect(204, {});
            }
            await request(app.getHttpServer())
                .post(DISCARD_REDRIVE_PATH)
                .set('Idempotency-Key', key)
                .auth('discard', { type: 'bearer' })
                .send({ ids: [untouched] })
                .expect(409);
            expect(await discardAudit(ids[0]!)).toHaveLength(1);
            expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id: untouched })).toHaveLength(1);
        } finally {
            await database.delete(operation).where(eq(operation.key, key));
        }
    });

    it('returns 204 to concurrent requests with the same key and commits one discard audit', async () => {
        const id = await createRedriveJob('failed');
        const key = randomUUID();
        try {
            const responses = await Promise.all(
                [0, 1].map(() =>
                    request(app.getHttpServer())
                        .post(DISCARD_REDRIVE_PATH)
                        .set('Idempotency-Key', key)
                        .auth('discard', { type: 'bearer' })
                        .send({ ids: [id] }),
                ),
            );
            expect(responses.map(({ status }) => status)).toStrictEqual([204, 204]);
            expect(await discardAudit(id)).toHaveLength(1);
            expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id })).toHaveLength(0);
        } finally {
            await database.delete(operation).where(eq(operation.key, key));
        }
    });

    it('keeps current authentication, permissions, and verified actor binding on replay', async () => {
        const id = await createRedriveJob('failed');
        const key = randomUUID();
        try {
            await request(app.getHttpServer())
                .post(DISCARD_REDRIVE_PATH)
                .set('Idempotency-Key', key)
                .auth('discard', { type: 'bearer' })
                .send({ ids: [id] })
                .expect(204);
            await request(app.getHttpServer())
                .post(DISCARD_REDRIVE_PATH)
                .set('Idempotency-Key', key)
                .send({ ids: [id] })
                .expect(401);
            await request(app.getHttpServer())
                .post(DISCARD_REDRIVE_PATH)
                .set('Idempotency-Key', key)
                .auth('read', { type: 'bearer' })
                .send({ ids: [id] })
                .expect(403);
            const claims = await tokenPort.verify<AccessTokenPayload>('discard', ACCESS_TOKEN_TYPE);
            const otherPrincipalClaims: AccessTokenPayload = { ...claims, sub: randomUUID() };
            vi.spyOn(tokenPort, 'verify').mockResolvedValueOnce(otherPrincipalClaims);
            await request(app.getHttpServer())
                .post(DISCARD_REDRIVE_PATH)
                .set('Idempotency-Key', key)
                .auth('discard', { type: 'bearer' })
                .send({ ids: [id] })
                .expect(409);
            expect(await discardAudit(id)).toHaveLength(1);
        } finally {
            await database.delete(operation).where(eq(operation.key, key));
        }
    });

    it.each([undefined, '', 'invalid', '019a548c-4000-7000-8000-000000000001'])(
        'rejects invalid idempotency key %s before mutation',
        async (key) => {
            const id = await createRedriveJob('failed');
            const call = request(app.getHttpServer()).post(DISCARD_REDRIVE_PATH).auth('discard', { type: 'bearer' });
            if (key !== undefined) {
                call.set('Idempotency-Key', key);
            }
            await call.send({ ids: [id] }).expect(400);
            expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id })).toHaveLength(1);
            expect(await discardAudit(id)).toHaveLength(0);
        },
    );

    it('discards one failed redrive, returns bodyless 204, and records one committed audit entry', async () => {
        const id = await createRedriveJob('failed');

        await request(app.getHttpServer())
            .post(DISCARD_REDRIVE_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('discard', { type: 'bearer' })
            .send({ ids: [id] })
            .expect(204, {});

        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id })).toHaveLength(0);
        const records = await discardAudit(id);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            action: JobQueueOperationsAuditAction.JOB_DEAD_LETTER_REDRIVE_DISCARDED,
            actorId: ACTOR_ID,
            actorType: PrincipalType.ADMIN,
            detail: { ids: [id] },
        });
    });

    it('rolls back the whole deletion when any requested redrive ID is missing', async () => {
        const existing = await createRedriveJob('failed');

        await request(app.getHttpServer())
            .post(DISCARD_REDRIVE_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('discard', { type: 'bearer' })
            .send({ ids: [existing, randomUUID()] })
            .expect(404, { error: { statusCode: 404, message: ['Not found.'], statusText: 'Not Found' } });

        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id: existing })).toHaveLength(1);
        expect(await discardAudit(existing)).toHaveLength(0);
    });

    it('cannot discard a job from the shared dead-letter queue', async () => {
        const dlqJobId = await boss.send(JOB_QUEUE_DEAD_LETTER, {
            deliveryId: randomUUID(),
            aggregateId: randomUUID(),
        });
        if (!dlqJobId) {
            throw new Error('The DLQ test job was not accepted.');
        }
        trackedJobs.set(dlqJobId, JOB_QUEUE_DEAD_LETTER);

        await request(app.getHttpServer())
            .post(DISCARD_REDRIVE_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('discard', { type: 'bearer' })
            .send({ ids: [dlqJobId] })
            .expect(404);

        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id: dlqJobId })).toHaveLength(1);
        expect(await discardAudit(dlqJobId)).toHaveLength(0);
    });

    it.each(['created', 'completed', 'cancelled'] as const)(
        'rejects discarding a redrive in %s state with 409 without deleting or auditing',
        async (state) => {
            const failed = await createRedriveJob('failed');
            const nonFailed = await createRedriveJob(state);

            await request(app.getHttpServer())
                .post(DISCARD_REDRIVE_PATH)
                .set('Idempotency-Key', randomUUID())
                .auth('discard', { type: 'bearer' })
                .send({ ids: [failed, nonFailed] })
                .expect(409);

            expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id: failed })).toHaveLength(1);
            expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id: nonFailed })).toHaveLength(1);
            expect(await discardAudit(failed)).toHaveLength(0);
            expect(await discardAudit(nonFailed)).toHaveLength(0);
        },
    );

    it('rolls the deletion back if the audit insert fails', async () => {
        const id = await createRedriveJob('failed');
        vi.spyOn(auditPort, 'record').mockRejectedValueOnce(new Error('Intentional audit failure.'));

        await request(app.getHttpServer())
            .post(DISCARD_REDRIVE_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('discard', { type: 'bearer' })
            .send({ ids: [id] })
            .expect(500);

        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id })).toHaveLength(1);
        expect(await discardAudit(id)).toHaveLength(0);
    });

    it('allows only one of two simultaneous discards to commit', async () => {
        const id = await createRedriveJob('failed');
        const responses = await Promise.all(
            [0, 1].map(() =>
                request(app.getHttpServer())
                    .post(DISCARD_REDRIVE_PATH)
                    .set('Idempotency-Key', randomUUID())
                    .auth('discard', { type: 'bearer' })
                    .send({ ids: [id] }),
            ),
        );

        expect(responses.map(({ status }) => status).sort()).toStrictEqual([204, 404]);
        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id })).toHaveLength(0);
        expect(await discardAudit(id)).toHaveLength(1);
    });

    it.each([
        ['missing field', {}],
        ['empty list', { ids: [] }],
        ['non-array', { ids: randomUUID() }],
        ['duplicate IDs', { ids: ['b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f', 'b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f'] }],
        ['invalid UUID', { ids: ['not-a-uuid'] }],
    ])('rejects %s without changing jobs or audit', async (_label, body) => {
        const id = await createRedriveJob('failed');

        await request(app.getHttpServer())
            .post(DISCARD_REDRIVE_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('discard', { type: 'bearer' })
            .send(body)
            .expect(400);

        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id })).toHaveLength(1);
        expect(await discardAudit(id)).toHaveLength(0);
    });

    it('requires authentication and the discard permission, not read or redrive permission', async () => {
        const id = await createRedriveJob('failed');

        await request(app.getHttpServer())
            .post(DISCARD_REDRIVE_PATH)
            .set('Idempotency-Key', randomUUID())
            .send({ ids: [id] })
            .expect(401);
        await request(app.getHttpServer())
            .post(DISCARD_REDRIVE_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('read', { type: 'bearer' })
            .send({ ids: [id] })
            .expect(403);
        await request(app.getHttpServer())
            .post(DISCARD_REDRIVE_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('redrive', { type: 'bearer' })
            .send({ ids: [id] })
            .expect(403);
        await request(app.getHttpServer())
            .post(DISCARD_REDRIVE_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('none', { type: 'bearer' })
            .send({ ids: [id] })
            .expect(403);

        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER_REDRIVE, { id })).toHaveLength(1);
        expect(await discardAudit(id)).toHaveLength(0);
    });
});
