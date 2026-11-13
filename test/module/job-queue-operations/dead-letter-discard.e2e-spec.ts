/**
 * @file dead-letter-discard.e2e-spec.ts
 * @description Verifies exact dead-letter discard through HTTP, pg-boss, and transactional audit.
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database';
import { operation } from 'src/core/idempotency/idempotency.schema';
import { JOB_QUEUE_DEAD_LETTER } from 'src/core/job-queue';
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
const DISCARD_PATH = '/api/v1/job-operations/dead-letter/discard';

/**
 * Unique operator identity keeps test audit rows separate from other suites.
 */
const ACTOR_ID = randomUUID();

/**
 * An isolated non-DLQ queue used to prove discard cannot touch other queues.
 */
const OTHER_QUEUE = `test.dlq-discard.${randomUUID()}`;

describe('Dead-letter discard', () => {
    let app: NestFastifyApplication;
    let boss: PgBoss;
    let database: NodePgDatabase;
    let auditPort: IAuditPort;
    let tokenPort: ITokenPort<typeof ACCESS_TOKEN_TYPE>;
    let sessionPort: ISessionPort;

    /**
     * Test-owned jobs are removed even when a test assertion fails.
     */
    const jobs = new Map<string, string>();

    /**
     * Creates one test-owned job without starting a DLQ worker.
     *
     * @param queue Queue in which to store the job
     * @returns Persisted pg-boss job identifier
     */
    async function sendJob(queue: string = JOB_QUEUE_DEAD_LETTER): Promise<string> {
        const id = await boss.send(queue, { deliveryId: randomUUID(), aggregateId: randomUUID() });

        if (!id) {
            throw new Error('The test job was not accepted.');
        }

        jobs.set(id, queue);

        return id;
    }

    /**
     * Reads only discard evidence associated with one test-owned job.
     *
     * @param jobId Job identifier present in the audit detail
     * @returns Matching audit rows
     */
    async function discardAudit(jobId: string) {
        return database
            .select()
            .from(audit)
            .where(
                and(
                    eq(audit.action, JobQueueOperationsAuditAction.JOB_DEAD_LETTER_DISCARDED),
                    sql`${audit.detail} -> 'jobIds' @> ${JSON.stringify([jobId])}::jsonb`,
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
        await boss.createQueue(OTHER_QUEUE, { policy: 'standard', partition: false });
    });

    beforeEach(() => {
        vi.spyOn(tokenPort, 'verify').mockImplementation((token) => {
            if (token !== 'discard' && token !== 'read' && token !== 'none') {
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
                          : [],
                sessionVersion: 0,
                type: ACCESS_TOKEN_TYPE,
            });
        });
        vi.spyOn(sessionPort, 'isSessionActive').mockResolvedValue(true);
    });

    afterEach(async () => {
        for (const [id, queue] of jobs) {
            await boss.deleteJob(queue, id);
        }

        jobs.clear();
        await database.delete(audit).where(eq(audit.actorId, ACTOR_ID));
    });

    afterAll(async () => {
        if (boss) {
            await boss.deleteQueue(OTHER_QUEUE);
        }

        if (app) {
            await app.close();
        }
    });

    it('replays a bulk 204 after a lost response, accepts reordered IDs, and rejects changed selection', async () => {
        const ids = [await sendJob(), await sendJob()];
        const untouched = await sendJob();
        const key = randomUUID();
        try {
            for (const jobIds of [ids, [...ids].reverse()]) {
                await request(app.getHttpServer())
                    .post(DISCARD_PATH)
                    .set('Idempotency-Key', key)
                    .auth('discard', { type: 'bearer' })
                    .send({ jobIds })
                    .expect(204, {});
            }
            await request(app.getHttpServer())
                .post(DISCARD_PATH)
                .set('Idempotency-Key', key)
                .auth('discard', { type: 'bearer' })
                .send({ jobIds: [untouched] })
                .expect(409);
            expect(await discardAudit(ids[0]!)).toHaveLength(1);
            expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id: untouched })).toHaveLength(1);
        } finally {
            await database.delete(operation).where(eq(operation.key, key));
        }
    });

    it('returns 204 to concurrent requests with the same key and commits one discard audit', async () => {
        const id = await sendJob();
        const key = randomUUID();
        try {
            const responses = await Promise.all(
                [0, 1].map(() =>
                    request(app.getHttpServer())
                        .post(DISCARD_PATH)
                        .set('Idempotency-Key', key)
                        .auth('discard', { type: 'bearer' })
                        .send({ jobIds: [id] }),
                ),
            );
            expect(responses.map(({ status }) => status)).toStrictEqual([204, 204]);
            expect(await discardAudit(id)).toHaveLength(1);
            expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id })).toHaveLength(0);
        } finally {
            await database.delete(operation).where(eq(operation.key, key));
        }
    });

    it('keeps current authentication, permissions, and verified actor binding on replay', async () => {
        const id = await sendJob();
        const key = randomUUID();
        try {
            await request(app.getHttpServer())
                .post(DISCARD_PATH)
                .set('Idempotency-Key', key)
                .auth('discard', { type: 'bearer' })
                .send({ jobIds: [id] })
                .expect(204);
            await request(app.getHttpServer())
                .post(DISCARD_PATH)
                .set('Idempotency-Key', key)
                .send({ jobIds: [id] })
                .expect(401);
            await request(app.getHttpServer())
                .post(DISCARD_PATH)
                .set('Idempotency-Key', key)
                .auth('read', { type: 'bearer' })
                .send({ jobIds: [id] })
                .expect(403);
            const claims = await tokenPort.verify<AccessTokenPayload>('discard', ACCESS_TOKEN_TYPE);
            const otherPrincipalClaims: AccessTokenPayload = { ...claims, sub: randomUUID() };
            vi.spyOn(tokenPort, 'verify').mockResolvedValueOnce(otherPrincipalClaims);
            await request(app.getHttpServer())
                .post(DISCARD_PATH)
                .set('Idempotency-Key', key)
                .auth('discard', { type: 'bearer' })
                .send({ jobIds: [id] })
                .expect(409);
            expect(await discardAudit(id)).toHaveLength(1);
        } finally {
            await database.delete(operation).where(eq(operation.key, key));
        }
    });

    it.each([undefined, '', 'invalid', '019a548c-4000-7000-8000-000000000001'])(
        'rejects invalid idempotency key %s before mutation',
        async (key) => {
            const id = await sendJob();
            const call = request(app.getHttpServer()).post(DISCARD_PATH).auth('discard', { type: 'bearer' });
            if (key !== undefined) {
                call.set('Idempotency-Key', key);
            }
            await call.send({ jobIds: [id] }).expect(400);
            expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id })).toHaveLength(1);
            expect(await discardAudit(id)).toHaveLength(0);
        },
    );

    it('discards one DLQ job, returns bodyless 204, and records one committed audit entry', async () => {
        const id = await sendJob();

        await request(app.getHttpServer())
            .post(DISCARD_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('discard', { type: 'bearer' })
            .send({ jobIds: [id] })
            .expect(204, {});

        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id })).toHaveLength(0);
        const records = await discardAudit(id);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            action: JobQueueOperationsAuditAction.JOB_DEAD_LETTER_DISCARDED,
            actorId: ACTOR_ID,
            actorType: PrincipalType.ADMIN,
            detail: { jobIds: [id], count: '1' },
        });

        await request(app.getHttpServer())
            .get(`/api/v1/job-operations/dead-letter/jobs/${id}`)
            .auth('read', { type: 'bearer' })
            .expect(404);
    });

    it('discards a bulk selection while preserving an unselected DLQ job', async () => {
        const ids = [await sendJob(), await sendJob()] as const;
        const untouched = await sendJob();

        await request(app.getHttpServer())
            .post(DISCARD_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('discard', { type: 'bearer' })
            .send({ jobIds: ids })
            .expect(204);

        for (const id of ids) {
            expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id })).toHaveLength(0);
        }

        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id: untouched })).toHaveLength(1);
        const records = await discardAudit(ids[0]);
        expect(records).toHaveLength(1);
        expect(records[0]?.detail).toStrictEqual({ jobIds: ids, count: '2' });
    });

    it('rolls back the whole deletion when any requested DLQ ID is missing', async () => {
        const existing = await sendJob();

        await request(app.getHttpServer())
            .post(DISCARD_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('discard', { type: 'bearer' })
            .send({ jobIds: [existing, randomUUID()] })
            .expect(404, { error: { statusCode: 404, message: ['Not found.'], statusText: 'Not Found' } });

        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id: existing })).toHaveLength(1);
        expect(await discardAudit(existing)).toHaveLength(0);
    });

    it('cannot delete a job from another queue', async () => {
        const other = await sendJob(OTHER_QUEUE);

        await request(app.getHttpServer())
            .post(DISCARD_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('discard', { type: 'bearer' })
            .send({ jobIds: [other] })
            .expect(404);

        expect(await boss.findJobs(OTHER_QUEUE, { id: other })).toHaveLength(1);
        expect(await discardAudit(other)).toHaveLength(0);
    });

    it('rolls the deletion back if the audit insert fails', async () => {
        const id = await sendJob();
        vi.spyOn(auditPort, 'record').mockRejectedValueOnce(new Error('Intentional audit failure.'));

        await request(app.getHttpServer())
            .post(DISCARD_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('discard', { type: 'bearer' })
            .send({ jobIds: [id] })
            .expect(500);

        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id })).toHaveLength(1);
        expect(await discardAudit(id)).toHaveLength(0);
    });

    it('allows only one of two simultaneous discards to commit', async () => {
        const id = await sendJob();
        const responses = await Promise.all(
            [0, 1].map(() =>
                request(app.getHttpServer())
                    .post(DISCARD_PATH)
                    .set('Idempotency-Key', randomUUID())
                    .auth('discard', { type: 'bearer' })
                    .send({ jobIds: [id] }),
            ),
        );

        expect(responses.map(({ status }) => status).sort()).toStrictEqual([204, 404]);
        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id })).toHaveLength(0);
        expect(await discardAudit(id)).toHaveLength(1);
    });

    it.each([
        ['missing field', {}],
        ['empty list', { jobIds: [] }],
        ['non-array', { jobIds: randomUUID() }],
        ['duplicate IDs', { jobIds: ['b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f', 'b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f'] }],
        ['invalid UUID', { jobIds: ['not-a-uuid'] }],
    ])('rejects %s without changing jobs or audit', async (_label, body) => {
        const id = await sendJob();

        await request(app.getHttpServer())
            .post(DISCARD_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('discard', { type: 'bearer' })
            .send(body)
            .expect(400);

        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id })).toHaveLength(1);
        expect(await discardAudit(id)).toHaveLength(0);
    });

    it('requires authentication and the discard permission, not merely read permission', async () => {
        const id = await sendJob();

        await request(app.getHttpServer())
            .post(DISCARD_PATH)
            .set('Idempotency-Key', randomUUID())
            .send({ jobIds: [id] })
            .expect(401);
        await request(app.getHttpServer())
            .post(DISCARD_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('read', { type: 'bearer' })
            .send({ jobIds: [id] })
            .expect(403);
        await request(app.getHttpServer())
            .post(DISCARD_PATH)
            .set('Idempotency-Key', randomUUID())
            .auth('none', { type: 'bearer' })
            .send({ jobIds: [id] })
            .expect(403);

        expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { id })).toHaveLength(1);
        expect(await discardAudit(id)).toHaveLength(0);
    });
});
