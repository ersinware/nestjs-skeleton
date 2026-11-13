/**
 * @file idempotency.e2e-spec.ts
 * @description Exercises real request claims, mutation evidence, jobs, and rollback through production ports.
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database';
import { TOKEN_IDEMPOTENCY_PORT, type IdempotencyRequest, type IIdempotencyPort } from 'src/core/idempotency';
import { operation } from 'src/core/idempotency/idempotency.schema';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { TOKEN_JOB_QUEUE_WRITER_PORT, type IJobQueueWriterPort } from 'src/core/job-queue/port/job-queue-writer.port';
import { audit, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_ERROR_REPORTER_PORT } from 'src/core/observability/error-reporter';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { defineAuditAction } from 'src/shared/domain/audit';
import { ExceptionKind } from 'src/shared/exception';
import { createTestApp } from 'test/shared/test-app.factory';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Test-owned queue has no consumer, making committed delivery counts observable.
 */
const QUEUE = `test.idempotency.${randomUUID()}`;

/**
 * Isolates mutation evidence from production actions.
 */
const ACTION = defineAuditAction('TEST_IDEMPOTENCY_COMMITTED');

describe('PostgreSQL request idempotency', () => {
    let app: NestFastifyApplication;
    let database: NodePgDatabase;
    let port: IIdempotencyPort;
    let boss: PgBoss;
    let jobs: IJobQueueWriterPort;
    let auditPort: IAuditPort;
    let hashing: IHashingPort;
    const keys: string[] = [];

    /**
     * Allocates an isolated logical request with deliberately sensitive semantic input.
     *
     * @returns Request tracked for cleanup
     */
    function request(): IdempotencyRequest {
        const key = randomUUID();
        keys.push(key);
        return {
            key,
            canonicalValue: JSON.stringify([
                'POST',
                '/probe',
                'password-secret',
                'token-secret',
                { payload: 'private' },
            ]),
        };
    }

    /**
     * Writes a business row, delivery, and evidence through the same ambient transaction.
     *
     * @param key Logical operation identifier used only to observe test-owned effects
     * @returns Stable replay identity
     */
    async function mutate(key: string): Promise<{ replayResultId: string }> {
        await database.execute(sql`INSERT INTO public.idempotency_probe (id) VALUES (${key})`);
        await jobs.enqueue([{ deliveryId: randomUUID(), aggregateId: key, queueName: QUEUE }]);
        await auditPort.record({ action: ACTION, targetId: key });
        return { replayResultId: key };
    }

    /**
     * Observes all durable effects independently of the adapter result.
     *
     * @param key Test-owned logical request
     * @param count Expected committed effects
     */
    async function expectEffects(key: string, count: number): Promise<void> {
        const rows = await database.execute(sql`SELECT id FROM public.idempotency_probe WHERE id = ${key}`);
        expect(rows.rows).toHaveLength(count);
        expect(await database.select().from(audit).where(eq(audit.targetId, key))).toHaveLength(count);
        const deliveries = await database.execute(
            sql`SELECT id FROM pgboss.job WHERE name = ${QUEUE} AND data ->> 'aggregateId' = ${key}`,
        );
        expect(deliveries.rows).toHaveLength(count);
        expect(await database.select().from(operation).where(eq(operation.key, key))).toHaveLength(count);
    }

    beforeAll(async () => {
        app = await createTestApp({
            overrides: [{ provide: TOKEN_ERROR_REPORTER_PORT, useValue: { report: vi.fn() } }],
        });
        database = app.get(TOKEN_DATABASE_CLIENT);
        port = app.get(TOKEN_IDEMPOTENCY_PORT);
        boss = app.get(TOKEN_JOB_QUEUE_CLIENT);
        jobs = app.get(TOKEN_JOB_QUEUE_WRITER_PORT);
        auditPort = app.get(TOKEN_AUDIT_PORT);
        hashing = app.get(TOKEN_HASHING_PORT);
        await boss.createQueue(QUEUE, { policy: 'standard', partition: false });
        await database.execute(
            sql`CREATE TABLE public.idempotency_probe (id uuid PRIMARY KEY DEFERRABLE INITIALLY DEFERRED)`,
        );
    });

    afterEach(async () => {
        if (keys.length) {
            await database.delete(operation).where(inArray(operation.key, keys));
            await database.delete(audit).where(inArray(audit.targetId, keys));
            await database.execute(
                sql`DELETE FROM public.idempotency_probe WHERE id IN (${sql.join(
                    keys.map((key) => sql`${key}::uuid`),
                    sql`, `,
                )})`,
            );
            keys.length = 0;
        }
        await boss.deleteAllJobs(QUEUE);
    });

    afterAll(async () => {
        if (app) {
            await database.execute(sql`DROP TABLE IF EXISTS public.idempotency_probe`);
            await boss.deleteQueue(QUEUE);
            await app.close();
        }
    });

    it('replays the committed result after a lost response without duplicate mutation, audit, or job', async () => {
        const input = request();
        await port.execute(input, () => mutate(input.key));
        const work = vi.fn(() => mutate(input.key));
        await expect(port.execute(input, work)).resolves.toStrictEqual({ replayResultId: input.key });
        expect(work).not.toHaveBeenCalled();
        await expectEffects(input.key, 1);
    });

    it('rejects a different fingerprint without executing its mutation', async () => {
        const input = request();
        await port.execute(input, () => mutate(input.key));
        const work = vi.fn(() => mutate(input.key));
        await expect(port.execute({ ...input, canonicalValue: 'changed' }, work)).rejects.toMatchObject({
            kind: ExceptionKind.RESOURCE_CONFLICT,
        });
        expect(work).not.toHaveBeenCalled();
        await expectEffects(input.key, 1);
    });

    it('serializes simultaneous same-key requests into one committed mutation', async () => {
        const input = request();
        const work = vi.fn(async () => {
            await database.execute(sql`SELECT pg_sleep(0.1)`);
            return mutate(input.key);
        });
        const results = await Promise.all([
            port.execute(input, work),
            port.execute(input, work),
            port.execute(input, work),
        ]);
        expect(results).toStrictEqual(Array.from({ length: 3 }, () => ({ replayResultId: input.key })));
        expect(work).toHaveBeenCalledTimes(1);
        await expectEffects(input.key, 1);
    });

    it.each(['callback', 'commit'])(
        'rolls back the claim, business state, audit, and job on %s failure and permits the same key again',
        async (failure) => {
            const input = request();
            await expect(
                port.execute(input, async () => {
                    const result = await mutate(input.key);
                    if (failure === 'callback') {
                        throw new Error('Intentional mutation failure.');
                    }
                    await database.execute(sql`INSERT INTO public.idempotency_probe (id) VALUES (${input.key})`);
                    return result;
                }),
            ).rejects.toThrow();
            await expectEffects(input.key, 0);
            await expect(port.execute(input, () => mutate(input.key))).resolves.toStrictEqual({
                replayResultId: input.key,
            });
            await expectEffects(input.key, 1);
        },
    );

    it('persists only the key, shared-port HMAC, minimal replay identity, and timestamp', async () => {
        const input = request();
        const hmac = vi.spyOn(hashing, 'hmacSha256');
        await port.execute(input, () => mutate(input.key));
        expect(hmac).toHaveBeenCalledWith('postgres:idempotency-fingerprint', input.canonicalValue);
        const [retained] = await database.select().from(operation).where(eq(operation.key, input.key));
        expect(retained).toStrictEqual({
            key: input.key,
            fingerprint: hashing.hmacSha256('postgres:idempotency-fingerprint', input.canonicalValue),
            replayResultId: input.key,
            createdAt: retained?.createdAt,
        });
        expect(retained?.createdAt).toBeInstanceOf(Date);
        expect(JSON.stringify(retained)).not.toMatch(/password-secret|token-secret|private|payload/);
        const columns = await database.execute<{ column_name: string }>(
            sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'idempotency' AND table_name = 'operation' ORDER BY column_name`,
        );
        expect(columns.rows.map((row) => row.column_name)).toStrictEqual([
            'created_at',
            'fingerprint',
            'key',
            'replay_result_id',
        ]);
    });

    it('replays prepared success before expired proofs or external reads and rejects changed input first', async () => {
        const input = request();
        await port.executePrepared(
            input,
            () => Promise.resolve('proof'),
            () => mutate(input.key),
        );
        const prepare = vi.fn(() => Promise.reject(new Error('Expired proof.')));
        const work = vi.fn(() => mutate(input.key));
        await expect(port.executePrepared(input, prepare, work)).resolves.toStrictEqual({ replayResultId: input.key });
        await expect(
            port.executePrepared({ ...input, canonicalValue: 'different' }, prepare, work),
        ).rejects.toMatchObject({ kind: ExceptionKind.RESOURCE_CONFLICT });
        expect(prepare).not.toHaveBeenCalled();
        expect(work).not.toHaveBeenCalled();
        await expectEffects(input.key, 1);
    });

    it('does not retain a failed preparation and allows a later successful attempt with the same key', async () => {
        const input = request();
        const error = new Error('Unavailable proof.');
        const work = vi.fn(() => mutate(input.key));
        await expect(port.executePrepared(input, () => Promise.reject(error), work)).rejects.toBe(error);
        expect(work).not.toHaveBeenCalled();
        await expectEffects(input.key, 0);
        await port.executePrepared(input, () => Promise.resolve('valid'), work);
        await expectEffects(input.key, 1);
    });

    it('waits for an uncommitted winner even when concurrent preparation fails', async () => {
        const input = request();
        let entered!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const winner = port.execute(input, async () => {
            entered();
            await gate;
            return mutate(input.key);
        });
        await started;
        const work = vi.fn(() => mutate(input.key));
        const follower = port.executePrepared(
            input,
            () => {
                release();
                return Promise.reject(new Error('Proof consumed by competing request.'));
            },
            work,
        );
        await expect(Promise.all([winner, follower])).resolves.toStrictEqual([
            { replayResultId: input.key },
            { replayResultId: input.key },
        ]);
        expect(work).not.toHaveBeenCalled();
        await expectEffects(input.key, 1);
    });
});
