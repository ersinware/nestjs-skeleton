/**
 * @file admin-activation.e2e-spec.ts
 * @description Verifies invited admin activation, atomic avatar delivery, and storage reconciliation through production wiring.
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import type { PgBoss } from 'pg-boss';
import { CommandPipeline } from 'src/core/cqrs';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database';
import { TOKEN_EMAILER_PORT, type IEmailerPort } from 'src/core/email';
import { TOKEN_JOB_QUEUE_WRITER_PORT, type IJobQueueWriterPort, type Job } from 'src/core/job-queue';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { audit, AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { TOKEN_STORAGE_PORT } from 'src/core/storage';
import { CreateAdminCommand } from 'src/module/admin/application/command/create-admin/command';
import { ReInviteAdminCommand } from 'src/module/admin/application/command/re-invite-admin/command';
import { AdminAvatarQueue } from 'src/module/admin/application/queue/admin-avatar.queue';
import { AdminInviteQueue } from 'src/module/admin/application/queue/admin-invite.queue';
import {
    buildAdminPendingAvatarKey,
    buildAdminPermanentAvatarKey,
} from 'src/module/admin/domain/admin-avatar-key.util';
import { AdminUploadPurpose } from 'src/module/admin/domain/admin-upload-purpose.enum';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';
import { admin } from 'src/module/admin/infrastructure/admin.schema';
import type { PostAdminActivateDto } from 'src/module/admin/presentation/dto/post-admin-activate.dto';
import { DomainFailureAuditAction } from 'src/shared/domain/audit';
import type { AvatarUploadDescriptor } from 'src/shared/domain/avatar';
import { PrincipalType } from 'src/shared/domain/principal';
import { DependencyUnavailableException, ExceptionKind } from 'src/shared/exception';
import { createStorageTestFixture, type StorageTestFixture } from 'test/shared/storage-test.factory';
import { createTestApp } from 'test/shared/test-app.factory';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe('Admin invitation with avatar', () => {
    let app: NestFastifyApplication;
    let fixture: StorageTestFixture;
    let database: NodePgDatabase;
    let boss: PgBoss;
    let pipeline: CommandPipeline;
    let tokens: ITokenPort;
    const ids: string[] = [];
    const objectKeys = new Set<string>();
    const sendEmail = vi.fn<IEmailerPort['sendEmail']>();
    const password = 'Admin-avatar!Test123';
    const avatar: AvatarUploadDescriptor = { sizeBytes: 4, contentType: 'image/png' };

    beforeAll(async () => {
        fixture = await createStorageTestFixture();
        app = await createTestApp({
            overrides: [
                { provide: TOKEN_EMAILER_PORT, useValue: { sendEmail } },
                { provide: TOKEN_STORAGE_PORT, useValue: fixture.storage },
            ],
        });
        database = app.get(TOKEN_DATABASE_CLIENT);
        boss = app.get(TOKEN_JOB_QUEUE_CLIENT);
        pipeline = app.get(CommandPipeline);
        tokens = app.get(TOKEN_TOKEN_PORT);
        for (const queue of await boss.getQueues()) {
            await boss.offWork(queue.name);
        }
    }, 30_000);

    afterAll(async () => {
        try {
            if (app) {
                for (const queue of await boss.getQueues()) {
                    await boss.offWork(queue.name);
                    for (const id of ids) {
                        const jobs = await boss.findJobs<Job>(queue.name, { data: { aggregateId: id } });
                        if (jobs.length) {
                            await boss.deleteJob(
                                queue.name,
                                jobs.map((job) => job.id),
                            );
                        }
                    }
                }
                for (const id of ids) {
                    await database.delete(audit).where(or(eq(audit.actorId, id), eq(audit.targetId, id)));
                    await database.delete(admin).where(eq(admin.id, id));
                    const redis = app.get<Redis>(TOKEN_SESSION_CONNECTION);
                    let cursor = '0';
                    do {
                        const [next, keys] = await redis.scan(cursor, 'MATCH', `auth:{${id}}:*`, 'COUNT', 100);
                        cursor = next;
                        if (keys.length) {
                            await redis.del(...keys);
                        }
                    } while (cursor !== '0');
                }
                await app.close();
            }
        } finally {
            if (fixture) {
                for (const key of objectKeys) {
                    await fixture.storage.deleteObject(key);
                }
                await fixture.close();
            }
        }
    }, 30_000);

    /**
     * Reads committed state without query caches.
     *
     * @param id Run-owned admin identity
     * @returns Persisted account
     */
    async function state(id: string): Promise<typeof admin.$inferSelect> {
        return (await database.select().from(admin).where(eq(admin.id, id)))[0]!;
    }

    /**
     * Observes durable owner work.
     *
     * @param id Run-owned admin identity
     * @param queue Queue being inspected
     * @returns Persisted deliveries
     */
    async function jobs(
        id: string,
        queue = AdminJobQueue.AVATAR_MOVE,
    ): Promise<Awaited<ReturnType<PgBoss['findJobs']>>> {
        return boss.findJobs<Job>(queue, { data: { aggregateId: id } });
    }

    /**
     * Observes mutation evidence.
     *
     * @param id Run-owned admin identity
     * @param action Committed action
     * @returns Matching durable records
     */
    async function evidence(
        id: string,
        action: AuditAction | DomainFailureAuditAction,
    ): Promise<(typeof audit.$inferSelect)[]> {
        return (await database.select().from(audit).where(eq(audit.targetId, id))).filter(
            (row) => row.action === action,
        );
    }

    /**
     * Creates a pending account through its production command and obtains the actual emailed JWT.
     *
     * @returns Invitation form and persisted identity
     */
    async function invite(): Promise<
        Omit<PostAdminActivateDto, 'uploadToken'> & {
            /**
             * Run-owned account identity.
             */
            readonly id: string;
        }
    > {
        const email = `${uuidv7()}@example.test`;
        await pipeline.execute(new CreateAdminCommand(email, 'Invited Admin'));
        const row = (await database.select().from(admin).where(eq(admin.email, email)))[0]!;
        ids.push(row.id);
        expect(row.password).toBeNull();
        expect(row.avatarKey).toBeNull();
        const deliveries = await boss.findJobs<Job>(AdminJobQueue.INVITE, { data: { aggregateId: row.id } });
        expect(deliveries).toHaveLength(1);
        await app.get(AdminInviteQueue).consume(deliveries[0]!.data);
        const emailPayload = sendEmail.mock.calls.at(-1)![0];
        expect(emailPayload.to).toBe(email);
        const href = /href="([^"]+)"/.exec(emailPayload.body)![1]!.replaceAll('&amp;', '&');
        const token = new URL(href).searchParams.get('token')!;
        return { id: row.id, token, password, avatar };
    }

    /**
     * Initiates and optionally uploads using the signed HTTP request.
     *
     * @param upload Whether to PUT the pending object
     * @param contents Actual object body for metadata rejection tests
     * @returns Final activation payload and stable keys
     */
    async function prepare(
        upload = true,
        contents = 'test',
    ): Promise<{
        /**
         * Run-owned account identity.
         */
        readonly id: string;
        /**
         * Final HTTP activation form.
         */
        readonly payload: PostAdminActivateDto;
        /**
         * Pending object tracked for cleanup.
         */
        readonly sourceKey: string;
        /**
         * Immutable object tracked for cleanup.
         */
        readonly destinationKey: string;
        /**
         * Consumed invitation identity retained across retries.
         */
        readonly deliveryId: string;
    }> {
        const { id, ...form } = await invite();
        const before = await state(id);
        const response = await app.inject({ method: 'POST', url: '/api/v1/admin/activate/initiate', payload: form });
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        const plan = response.json<{
            data: { mode: string; uploadToken: string; request: { url: string; headers: Record<string, string> } };
        }>().data;
        expect(plan.mode).toBe('single');
        expect(plan.request.headers).toMatchObject({
            'content-type': 'image/png',
            'if-none-match': '*',
            'cache-control': 'no-store',
        });
        const claims = await tokens.verifyUploadToken(plan.uploadToken, AdminUploadPurpose.ACTIVATION);
        const sourceKey = buildAdminPendingAvatarKey(id, before.inviteId!);
        const destinationKey = buildAdminPermanentAvatarKey(id, before.inviteId!);
        expect(claims).toMatchObject({ sub: id, fileKey: sourceKey });
        expect(claims.exp).toBeLessThanOrEqual(before.inviteExpiresAt!.getTime() / 1000);
        expect(await state(id)).toEqual(before);
        expect(await jobs(id)).toEqual([]);
        objectKeys.add(sourceKey);
        objectKeys.add(destinationKey);
        if (upload) {
            expect(
                (
                    await fetch(plan.request.url, {
                        method: 'PUT',
                        headers: plan.request.headers,
                        body: Buffer.from(contents),
                    })
                ).ok,
            ).toBe(true);
        }
        return {
            id,
            payload: { ...form, uploadToken: plan.uploadToken },
            sourceKey,
            destinationKey,
            deliveryId: before.inviteId!,
        };
    }

    it('commits activation once, opens no session, and finalizes the immutable avatar repeat-safely', async () => {
        const prepared = await prepare();
        const openSession = vi.spyOn(app.get<ISessionPort>(TOKEN_SESSION_PORT), 'openSession');
        const response = await app.inject({ method: 'POST', url: '/api/v1/admin/activate', payload: prepared.payload });
        expect(response.statusCode).toBe(204);
        expect(response.body).toBe('');
        expect(openSession).not.toHaveBeenCalled();
        const row = await state(prepared.id);
        expect(await app.get<IHashingPort>(TOKEN_HASHING_PORT).verify(row.password!, password)).toBe(true);
        expect(row).toMatchObject({
            avatarKey: prepared.sourceKey,
            inviteId: null,
            inviteExpiresAt: null,
            inviteRevocationVersion: null,
            sessionVersion: 0,
            revocationVersion: 0,
        });
        const deliveries = await boss.findJobs<Job>(AdminJobQueue.AVATAR_MOVE, { data: { aggregateId: prepared.id } });
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0]!.data).toMatchObject({ deliveryId: prepared.deliveryId, aggregateId: prepared.id });
        expect(await evidence(prepared.id, AuditAction.ADMIN_ACTIVATED)).toHaveLength(1);
        expect(
            (await app.inject({ method: 'POST', url: '/api/v1/admin/activate', payload: prepared.payload })).statusCode,
        ).toBe(409);
        expect(await jobs(prepared.id)).toHaveLength(1);
        await app.get(AdminAvatarQueue).consume(deliveries[0]!.data);
        const finalized = await state(prepared.id);
        expect(finalized.avatarKey).toBe(prepared.destinationKey);
        expect(await fixture.readCacheControl(prepared.destinationKey)).toBe(
            'public, max-age=31536000, s-maxage=31536000, immutable',
        );
        await expect(fixture.storage.headObject(prepared.sourceKey)).rejects.toMatchObject({
            kind: ExceptionKind.RESOURCE_NOT_FOUND,
        });
        await app.get(AdminAvatarQueue).consume(deliveries[0]!.data);
        expect(await state(prepared.id)).toEqual(finalized);
        expect(await evidence(prepared.id, AuditAction.ADMIN_AVATAR_FINALIZED)).toHaveLength(1);
        const login = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/admin/login',
            payload: { email: finalized.email, password },
        });
        expect(login.statusCode).toBe(200);
        const accessToken = login.json<{ data: { accessToken: string } }>().data.accessToken;
        const profile = await app.inject({
            method: 'GET',
            url: '/api/v1/admin/me',
            headers: { authorization: `Bearer ${accessToken}` },
        });
        expect(profile.statusCode).toBe(200);
        const publicProfile = profile.json<{ data: Record<string, unknown> }>().data;
        expect(publicProfile['avatarKey']).toBe(prepared.destinationKey);
        expect(publicProfile).not.toHaveProperty('password');
        expect(publicProfile).not.toHaveProperty('inviteId');
    });

    it.each(['password', 'size', 'type', 'missing-object', 'stored-size', 'wrong-purpose'] as const)(
        'rejects %s without activation, hashing, or avatar work',
        async (scenario) => {
            const prepared = await prepare(
                scenario !== 'missing-object',
                scenario === 'stored-size' ? 'longer' : 'test',
            );
            const before = await state(prepared.id);
            const payload = { ...prepared.payload };
            if (scenario === 'password') {
                payload.password = 'Different-password!123';
            }
            if (scenario === 'size') {
                payload.avatar = { ...avatar, sizeBytes: 5 };
            }
            if (scenario === 'type') {
                payload.avatar = { ...avatar, contentType: 'image/jpeg' };
            }
            if (scenario === 'wrong-purpose') {
                payload.uploadToken = payload.token;
            }
            const hash = vi.spyOn(app.get<IHashingPort>(TOKEN_HASHING_PORT), 'hash');
            const response = await app.inject({ method: 'POST', url: '/api/v1/admin/activate', payload });
            expect(response.statusCode).toBe(scenario === 'wrong-purpose' ? 401 : 400);
            expect(hash).not.toHaveBeenCalled();
            expect(await state(prepared.id)).toEqual(before);
            expect(await jobs(prepared.id)).toEqual([]);
            expect(await evidence(prepared.id, AuditAction.ADMIN_ACTIVATED)).toEqual([]);
        },
    );

    it.each(['reinvite', 'ban', 'delete'] as const)('rejects prepared activation after %s', async (change) => {
        const prepared = await prepare();
        if (change === 'reinvite') {
            await pipeline.execute(
                new ReInviteAdminCommand(prepared.id, { id: uuidv7(), type: PrincipalType.ADMIN, permissions: [] }),
            );
        } else {
            await database
                .update(admin)
                .set(change === 'ban' ? { isBanned: true } : { deletedAt: new Date() })
                .where(eq(admin.id, prepared.id));
        }
        const before = await state(prepared.id);
        const response = await app.inject({ method: 'POST', url: '/api/v1/admin/activate', payload: prepared.payload });
        expect(response.statusCode).toBe(change === 'ban' ? 403 : change === 'delete' ? 404 : 400);
        expect(await state(prepared.id)).toEqual(before);
        expect(await jobs(prepared.id)).toEqual([]);
        expect(await evidence(prepared.id, AuditAction.ADMIN_ACTIVATED)).toEqual([]);
        expect(await evidence(prepared.id, DomainFailureAuditAction.ADMIN_ACTIVATION_FAILED)).toHaveLength(
            change === 'ban' ? 1 : 0,
        );
    });

    it.each(['audit', 'enqueue'] as const)('rolls back activation when %s fails', async (failure) => {
        const prepared = await prepare();
        const before = await state(prepared.id);
        if (failure === 'audit') {
            vi.spyOn(app.get<IAuditPort>(TOKEN_AUDIT_PORT), 'record').mockRejectedValueOnce(
                new DependencyUnavailableException(),
            );
        } else {
            vi.spyOn(app.get<IJobQueueWriterPort>(TOKEN_JOB_QUEUE_WRITER_PORT), 'enqueue').mockRejectedValueOnce(
                new DependencyUnavailableException(),
            );
        }
        expect(
            (await app.inject({ method: 'POST', url: '/api/v1/admin/activate', payload: prepared.payload })).statusCode,
        ).toBe(503);
        expect(await state(prepared.id)).toEqual(before);
        expect(await jobs(prepared.id)).toEqual([]);
        expect(await evidence(prepared.id, AuditAction.ADMIN_ACTIVATED)).toEqual([]);
        expect(await fixture.storage.headObject(prepared.sourceKey)).toMatchObject({ sizeBytes: 4 });
    });

    it('allows only one concurrent activation commit', async () => {
        const prepared = await prepare();
        const responses = await Promise.all(
            [1, 2].map(() => app.inject({ method: 'POST', url: '/api/v1/admin/activate', payload: prepared.payload })),
        );
        expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 409]);
        expect(await jobs(prepared.id)).toHaveLength(1);
        expect(await evidence(prepared.id, AuditAction.ADMIN_ACTIVATED)).toHaveLength(1);
    });

    it('reuses a copied object after audit rollback and retries source cleanup after commit', async () => {
        const prepared = await prepare();
        expect(
            (await app.inject({ method: 'POST', url: '/api/v1/admin/activate', payload: prepared.payload })).statusCode,
        ).toBe(204);
        const job = (await boss.findJobs<Job>(AdminJobQueue.AVATAR_MOVE, { data: { aggregateId: prepared.id } }))[0]!
            .data;
        const before = await state(prepared.id);
        const auditSpy = vi
            .spyOn(app.get<IAuditPort>(TOKEN_AUDIT_PORT), 'record')
            .mockRejectedValueOnce(new DependencyUnavailableException());
        await expect(app.get(AdminAvatarQueue).consume(job)).rejects.toMatchObject({
            kind: ExceptionKind.DEPENDENCY_UNAVAILABLE,
        });
        expect(await state(prepared.id)).toEqual(before);
        expect(await evidence(prepared.id, AuditAction.ADMIN_AVATAR_FINALIZED)).toEqual([]);
        expect(await fixture.storage.headObject(prepared.sourceKey)).toMatchObject({ sizeBytes: 4 });
        expect(await fixture.storage.headObject(prepared.destinationKey)).toMatchObject({ sizeBytes: 4 });
        auditSpy.mockRestore();
        const copy = vi.spyOn(fixture.storage, 'copyObject');
        vi.spyOn(fixture.storage, 'deleteObject').mockRejectedValueOnce(new DependencyUnavailableException());
        await expect(app.get(AdminAvatarQueue).consume(job)).rejects.toMatchObject({
            kind: ExceptionKind.DEPENDENCY_UNAVAILABLE,
        });
        const committed = await state(prepared.id);
        expect(committed.avatarKey).toBe(prepared.destinationKey);
        await app.get(AdminAvatarQueue).consume(job);
        expect(copy).not.toHaveBeenCalled();
        expect(await state(prepared.id)).toEqual(committed);
        expect(await evidence(prepared.id, AuditAction.ADMIN_AVATAR_FINALIZED)).toHaveLength(1);
        await expect(fixture.storage.headObject(prepared.sourceKey)).rejects.toMatchObject({
            kind: ExceptionKind.RESOURCE_NOT_FOUND,
        });
    });

    it.each([
        { avatar: { sizeBytes: 0, contentType: 'image/png' } },
        { avatar: { sizeBytes: 5_242_881, contentType: 'image/png' } },
        { avatar: { sizeBytes: 4, contentType: 'text/plain' } },
    ])('validates avatar descriptors at the HTTP boundary: %j', async (invalid) => {
        const { id, ...form } = await invite();
        const before = await state(id);
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/admin/activate/initiate',
            payload: { ...form, ...invalid },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json<unknown>()).toMatchObject({ error: { statusCode: 400 } });
        expect(Array.isArray(response.json<{ error: { message: unknown } }>().error.message)).toBe(true);
        expect(await state(id)).toEqual(before);
        expect(await jobs(id)).toEqual([]);
    });
});
