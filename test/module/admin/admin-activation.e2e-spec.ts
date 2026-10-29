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
import { audit, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { TOKEN_STORAGE_PORT } from 'src/core/storage';
import { InviteAdminCommand } from 'src/module/admin/application/command/invite-admin/command';
import { ReInviteAdminCommand } from 'src/module/admin/application/command/re-invite-admin/command';
import { AdminAvatarFinalizeConsumer } from 'src/module/admin/application/consumer/admin-avatar-finalize.consumer';
import { AdminAvatarReplaceConsumer } from 'src/module/admin/application/consumer/admin-avatar-replace.consumer';
import { AdminInviteConsumer } from 'src/module/admin/application/consumer/admin-invite.consumer';
import {
    buildAdminPendingAvatarKey,
    buildAdminPermanentAvatarKey,
} from 'src/module/admin/domain/admin-avatar-key.util';
import { AdminUploadPurpose } from 'src/module/admin/domain/admin-upload-purpose.enum';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';
import { admin } from 'src/module/admin/infrastructure/admin.schema';
import type { PostAdminActivationDto } from 'src/module/admin/presentation/dto/post-admin-activation.dto';
import { AdminAuditAction } from 'src/module/admin/shared/admin-audit';
import { AVATAR_PERMANENT_CACHE_POLICY, type AvatarUploadDescriptor } from 'src/shared/domain/avatar';
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
                        const [next, keys] = await redis.scan(
                            cursor,
                            'MATCH',
                            `auth:{${PrincipalType.ADMIN}:${id}}:*`,
                            'COUNT',
                            100,
                        );
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
        queue = AdminJobQueue.AVATAR_FINALIZE,
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
    async function evidence(id: string, action: string): Promise<(typeof audit.$inferSelect)[]> {
        return (
            await database
                .select()
                .from(audit)
                .where(or(eq(audit.actorId, id), eq(audit.targetId, id)))
        ).filter((row) => row.action === action);
    }

    /**
     * Creates a pending account through its production command and obtains the actual emailed JWT.
     *
     * @returns Invitation form and persisted identity
     */
    async function invite(): Promise<
        Omit<PostAdminActivationDto, 'uploadToken'> & {
            /**
             * Run-owned account identity.
             */
            readonly id: string;
        }
    > {
        const email = `${uuidv7()}@example.test`;
        await pipeline.execute(new InviteAdminCommand(email, 'Invited Admin'));
        const row = (await database.select().from(admin).where(eq(admin.email, email)))[0]!;
        ids.push(row.id);
        expect(row.password).toBeNull();
        expect(row.avatarKey).toBeNull();
        const deliveries = await boss.findJobs<Job>(AdminJobQueue.INVITE, { data: { aggregateId: row.id } });
        expect(deliveries).toHaveLength(1);
        await app.get(AdminInviteConsumer).consume(deliveries[0]!.data);
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
        readonly payload: PostAdminActivationDto;
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
        const response = await app.inject({ method: 'POST', url: '/api/v1/admin/activation/initiate', payload: form });
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
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/admin/activation/complete',
            payload: prepared.payload,
        });
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
        const deliveries = await boss.findJobs<Job>(AdminJobQueue.AVATAR_FINALIZE, {
            data: { aggregateId: prepared.id },
        });
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0]!.data).toMatchObject({ deliveryId: prepared.deliveryId, aggregateId: prepared.id });
        expect(await evidence(prepared.id, AdminAuditAction.ADMIN_ACTIVATED)).toHaveLength(1);
        expect(
            (await app.inject({ method: 'POST', url: '/api/v1/admin/activation/complete', payload: prepared.payload }))
                .statusCode,
        ).toBe(409);
        expect(await jobs(prepared.id)).toHaveLength(1);
        await app.get(AdminAvatarFinalizeConsumer).consume(deliveries[0]!.data);
        const finalized = await state(prepared.id);
        expect(finalized.avatarKey).toBe(prepared.destinationKey);
        expect(await fixture.readCacheControl(prepared.destinationKey)).toBe(
            'public, max-age=31536000, s-maxage=31536000, immutable',
        );
        await expect(fixture.storage.headObject(prepared.sourceKey)).rejects.toMatchObject({
            kind: ExceptionKind.RESOURCE_NOT_FOUND,
        });
        await app.get(AdminAvatarFinalizeConsumer).consume(deliveries[0]!.data);
        expect(await state(prepared.id)).toEqual(finalized);
        expect(await evidence(prepared.id, AdminAuditAction.ADMIN_AVATAR_FINALIZED)).toHaveLength(1);
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
            const response = await app.inject({ method: 'POST', url: '/api/v1/admin/activation/complete', payload });
            expect(response.statusCode).toBe(400);
            expect(hash).not.toHaveBeenCalled();
            expect(await state(prepared.id)).toEqual(before);
            expect(await jobs(prepared.id)).toEqual([]);
            expect(await evidence(prepared.id, AdminAuditAction.ADMIN_ACTIVATED)).toEqual([]);
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
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/admin/activation/complete',
            payload: prepared.payload,
        });
        expect(response.statusCode).toBe(change === 'ban' ? 403 : change === 'delete' ? 404 : 400);
        expect(await state(prepared.id)).toEqual(before);
        expect(await jobs(prepared.id)).toEqual([]);
        expect(await evidence(prepared.id, AdminAuditAction.ADMIN_ACTIVATED)).toEqual([]);
        expect(await evidence(prepared.id, 'ADMIN_ACTIVATION_FAILED')).toHaveLength(change === 'ban' ? 1 : 0);
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
            (await app.inject({ method: 'POST', url: '/api/v1/admin/activation/complete', payload: prepared.payload }))
                .statusCode,
        ).toBe(503);
        expect(await state(prepared.id)).toEqual(before);
        expect(await jobs(prepared.id)).toEqual([]);
        expect(await evidence(prepared.id, AdminAuditAction.ADMIN_ACTIVATED)).toEqual([]);
        expect(await fixture.storage.headObject(prepared.sourceKey)).toMatchObject({ sizeBytes: 4 });
    });

    it('allows only one concurrent activation commit', async () => {
        const prepared = await prepare();
        const responses = await Promise.all(
            [1, 2].map(() =>
                app.inject({ method: 'POST', url: '/api/v1/admin/activation/complete', payload: prepared.payload }),
            ),
        );
        expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 409]);
        expect(await jobs(prepared.id)).toHaveLength(1);
        expect(await evidence(prepared.id, AdminAuditAction.ADMIN_ACTIVATED)).toHaveLength(1);
    });

    it('reuses a copied object after audit rollback and retries source cleanup after commit', async () => {
        const prepared = await prepare();
        expect(
            (await app.inject({ method: 'POST', url: '/api/v1/admin/activation/complete', payload: prepared.payload }))
                .statusCode,
        ).toBe(204);
        const job = (
            await boss.findJobs<Job>(AdminJobQueue.AVATAR_FINALIZE, { data: { aggregateId: prepared.id } })
        )[0]!.data;
        const before = await state(prepared.id);
        const auditSpy = vi
            .spyOn(app.get<IAuditPort>(TOKEN_AUDIT_PORT), 'record')
            .mockRejectedValueOnce(new DependencyUnavailableException());
        await expect(app.get(AdminAvatarFinalizeConsumer).consume(job)).rejects.toMatchObject({
            kind: ExceptionKind.DEPENDENCY_UNAVAILABLE,
        });
        expect(await state(prepared.id)).toEqual(before);
        expect(await evidence(prepared.id, AdminAuditAction.ADMIN_AVATAR_FINALIZED)).toEqual([]);
        expect(await fixture.storage.headObject(prepared.sourceKey)).toMatchObject({ sizeBytes: 4 });
        expect(await fixture.storage.headObject(prepared.destinationKey)).toMatchObject({ sizeBytes: 4 });
        auditSpy.mockRestore();
        const copy = vi.spyOn(fixture.storage, 'copyObject');
        vi.spyOn(fixture.storage, 'deleteObject').mockRejectedValueOnce(new DependencyUnavailableException());
        await expect(app.get(AdminAvatarFinalizeConsumer).consume(job)).rejects.toMatchObject({
            kind: ExceptionKind.DEPENDENCY_UNAVAILABLE,
        });
        const committed = await state(prepared.id);
        expect(committed.avatarKey).toBe(prepared.destinationKey);
        await app.get(AdminAvatarFinalizeConsumer).consume(job);
        expect(copy).not.toHaveBeenCalled();
        expect(await state(prepared.id)).toEqual(committed);
        expect(await evidence(prepared.id, AdminAuditAction.ADMIN_AVATAR_FINALIZED)).toHaveLength(1);
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
            url: '/api/v1/admin/activation/initiate',
            payload: { ...form, ...invalid },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json<unknown>()).toMatchObject({ error: { statusCode: 400 } });
        expect(Array.isArray(response.json<{ error: { message: unknown } }>().error.message)).toBe(true);
        expect(await state(id)).toEqual(before);
        expect(await jobs(id)).toEqual([]);
    });
    describe('Admin profile avatar updates', () => {
        /**
         * Run-owned authenticated account used by the profile endpoints.
         */
        type ProfileAccount = {
            /**
             * Account created and activated through production commands.
             */
            readonly id: string;
            /**
             * Session verified by the production global guards.
             */
            readonly headers: { readonly authorization: string };
        };

        /**
         * Profile upload tracked for observation and cleanup.
         */
        type ProfileUpload = {
            /**
             * Workflow proof returned by the HTTP endpoint.
             */
            readonly uploadToken: string;
            /**
             * Source selected by the verified upload proof.
             */
            readonly sourceKey: string;
            /**
             * Immutable destination selected by the delivery identity.
             */
            readonly destinationKey: string;
            /**
             * Avatar identity reused by every delivery attempt.
             */
            readonly deliveryId: string;
        };

        /**
         * Activates and signs in a fresh account without bypassing session guards.
         *
         * @returns Authenticated account scoped to this test run
         */
        async function account(): Promise<ProfileAccount> {
            const initial = await prepare();
            expect(
                (
                    await app.inject({
                        method: 'POST',
                        url: '/api/v1/admin/activation/complete',
                        payload: initial.payload,
                    })
                ).statusCode,
            ).toBe(204);
            const initialJob = (
                await boss.findJobs<Job>(AdminJobQueue.AVATAR_FINALIZE, { data: { aggregateId: initial.id } })
            )[0]!;
            await app.get(AdminAvatarFinalizeConsumer).consume(initialJob.data);
            const login = await app.inject({
                method: 'POST',
                url: '/api/v1/auth/admin/login',
                payload: { email: (await state(initial.id)).email, password },
            });
            expect(login.statusCode).toBe(200);
            return {
                id: initial.id,
                headers: {
                    authorization: `Bearer ${login.json<{ data: { accessToken: string } }>().data.accessToken}`,
                },
            };
        }

        /**
         * Initiates a profile upload and performs its signed PUT through the production storage port.
         *
         * @param owner Authenticated run-owned account
         * @param name Optional combined-update name
         * @param upload Whether to create the expected source object
         * @returns Proof and deterministic delivery keys
         */
        async function profileUpload(owner: ProfileAccount, name?: string, upload = true): Promise<ProfileUpload> {
            const before = await state(owner.id);
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/admin/me/avatar/initiate',
                headers: owner.headers,
                payload: { avatar, ...(name !== undefined && { name }) },
            });
            expect(response.statusCode).toBe(200);
            const plan = response.json<{
                data: { uploadToken: string; request: { url: string; headers: Record<string, string> } };
            }>().data;
            const claims = await tokens.verifyUploadToken(plan.uploadToken, AdminUploadPurpose.PROFILE_AVATAR);
            const destinationKey = buildAdminPermanentAvatarKey(owner.id, claims.jti);
            objectKeys.add(claims.fileKey);
            objectKeys.add(destinationKey);
            expect(await state(owner.id)).toEqual(before);
            if (upload) {
                expect(
                    (await fetch(plan.request.url, { method: 'PUT', headers: plan.request.headers, body: 'test' }))
                        .status,
                ).toBe(200);
            }
            return { uploadToken: plan.uploadToken, sourceKey: claims.fileKey, destinationKey, deliveryId: claims.jti };
        }

        it.each(['name-only', 'avatar-only', 'combined'] as const)(
            'commits %s and returns the selected profile',
            async (scenario) => {
                const owner = await account();
                const before = await state(owner.id);
                const beforeJobs = await jobs(owner.id, AdminJobQueue.AVATAR_REPLACE);
                const name = scenario === 'avatar-only' ? undefined : 'Updated Admin';
                const upload = scenario === 'name-only' ? undefined : await profileUpload(owner, name);
                const response = await app.inject({
                    method: 'PATCH',
                    url: '/api/v1/admin/me',
                    headers: owner.headers,
                    payload: {
                        ...(name !== undefined && { name }),
                        ...(upload && { avatar, uploadToken: upload.uploadToken }),
                    },
                });
                expect(response.statusCode).toBe(200);
                expect(response.json<unknown>()).toMatchObject({
                    data: { name: name ?? before.name, avatarKey: upload?.sourceKey ?? before.avatarKey },
                });
                const updated = await state(owner.id);
                expect(updated.sessionVersion).toBe(before.sessionVersion);
                expect(updated.revocationVersion).toBe(before.revocationVersion);
                expect(await evidence(owner.id, AdminAuditAction.ADMIN_UPDATED)).toHaveLength(1);
                expect(await jobs(owner.id, AdminJobQueue.AVATAR_REPLACE)).toHaveLength(
                    beforeJobs.length + (upload ? 1 : 0),
                );
                if (upload) {
                    const delivery = (
                        await boss.findJobs<Job>(AdminJobQueue.AVATAR_REPLACE, { data: { aggregateId: owner.id } })
                    ).find((job) => job.data.deliveryId === upload.deliveryId)!;
                    await app.get(AdminAvatarReplaceConsumer).consume(delivery.data);
                    await expect(fixture.storage.headObject(before.avatarKey!)).rejects.toMatchObject({
                        kind: ExceptionKind.RESOURCE_NOT_FOUND,
                    });
                    expect((await state(owner.id)).avatarKey).toBe(upload.destinationKey);
                    expect(await fixture.readCacheControl(upload.destinationKey)).toBe(
                        'public, max-age=31536000, s-maxage=31536000, immutable',
                    );
                    await expect(fixture.storage.headObject(upload.sourceKey)).rejects.toMatchObject({
                        kind: ExceptionKind.RESOURCE_NOT_FOUND,
                    });
                }
            },
        );

        it('rejects empty, null, invalid, and unknown profile fields without writes', async () => {
            const owner = await account();
            const before = await state(owner.id);
            const beforeJobs = await jobs(owner.id, AdminJobQueue.AVATAR_REPLACE);
            for (const payload of [
                {},
                { name: null },
                { name: '' },
                { avatar: null },
                { avatar: {} },
                { avatar },
                { uploadToken: 'a.b.c' },
                { avatar, uploadToken: null },
                { name: 'Valid Name', avatar },
                { unknown: true },
                { avatar: { ...avatar, unknown: true }, uploadToken: 'invalid' },
            ]) {
                const response = await app.inject({
                    method: 'PATCH',
                    url: '/api/v1/admin/me',
                    headers: owner.headers,
                    payload,
                });
                expect(response.statusCode).toBe(400);
                expect(response.json<unknown>()).toMatchObject({ error: { statusCode: 400 } });
            }
            expect(await state(owner.id)).toEqual(before);
            expect(await jobs(owner.id, AdminJobQueue.AVATAR_REPLACE)).toHaveLength(beforeJobs.length);
            expect(await evidence(owner.id, AdminAuditAction.ADMIN_UPDATED)).toEqual([]);
        });

        it.each(['expired', 'purpose', 'ownership', 'name-binding', 'missing-object'] as const)(
            'rejects %s before accepting a profile change',
            async (scenario) => {
                const owner = await account();
                const prepared = await profileUpload(owner, undefined, scenario !== 'missing-object');
                const before = await state(owner.id);
                const beforeJobs = await jobs(owner.id, AdminJobQueue.AVATAR_REPLACE);
                let uploadToken = prepared.uploadToken;
                if (scenario === 'expired' || scenario === 'purpose' || scenario === 'ownership') {
                    const claims = await tokens.verifyUploadToken(uploadToken, AdminUploadPurpose.PROFILE_AVATAR);
                    uploadToken = await tokens.generateUploadToken({
                        ...claims,
                        ...(scenario === 'expired' && { exp: Math.floor(Date.now() / 1000) - 1 }),
                        ...(scenario === 'purpose' && { purpose: AdminUploadPurpose.ACTIVATION }),
                        ...(scenario === 'ownership' && { sub: uuidv7() }),
                    });
                }
                const response = await app.inject({
                    method: 'PATCH',
                    url: '/api/v1/admin/me',
                    headers: owner.headers,
                    payload: {
                        ...(scenario === 'name-binding' && { name: 'Changed Admin' }),
                        avatar,
                        uploadToken,
                    },
                });
                expect(response.statusCode).toBe(scenario === 'ownership' ? 403 : 400);
                expect(await state(owner.id)).toEqual(before);
                expect(await jobs(owner.id, AdminJobQueue.AVATAR_REPLACE)).toHaveLength(beforeJobs.length);
                expect(await evidence(owner.id, AdminAuditAction.ADMIN_UPDATED)).toEqual([]);
            },
        );

        it.each(['audit', 'enqueue'] as const)(
            'rolls back the combined profile and move job when %s fails',
            async (failure) => {
                const owner = await account();
                const prepared = await profileUpload(owner, 'Updated Admin');
                const before = await state(owner.id);
                const beforeJobs = await jobs(owner.id, AdminJobQueue.AVATAR_REPLACE);
                if (failure === 'audit') {
                    const record = app.get<IAuditPort>(TOKEN_AUDIT_PORT);
                    const original = record.record.bind(record);
                    vi.spyOn(record, 'record').mockImplementation((entry, options) => {
                        if (entry.action === String(AdminAuditAction.ADMIN_UPDATED)) {
                            return Promise.reject(new DependencyUnavailableException());
                        }
                        return original(entry, options);
                    });
                } else {
                    vi.spyOn(
                        app.get<IJobQueueWriterPort>(TOKEN_JOB_QUEUE_WRITER_PORT),
                        'enqueue',
                    ).mockRejectedValueOnce(new DependencyUnavailableException());
                }
                const response = await app.inject({
                    method: 'PATCH',
                    url: '/api/v1/admin/me',
                    headers: owner.headers,
                    payload: { name: 'Updated Admin', avatar, uploadToken: prepared.uploadToken },
                });
                expect(response.statusCode).toBe(503);
                expect(await state(owner.id)).toEqual(before);
                expect(await jobs(owner.id, AdminJobQueue.AVATAR_REPLACE)).toHaveLength(beforeJobs.length);
                expect(await evidence(owner.id, AdminAuditAction.ADMIN_UPDATED)).toEqual([]);
                expect(await fixture.storage.headObject(prepared.sourceKey)).toMatchObject({ sizeBytes: 4 });
            },
        );

        it('reuses a copied replacement after rollback and resumes cleanup after commit', async () => {
            const owner = await account();
            const previous = (await state(owner.id)).avatarKey!;
            const prepared = await profileUpload(owner);
            const response = await app.inject({
                method: 'PATCH',
                url: '/api/v1/admin/me',
                headers: owner.headers,
                payload: { avatar, uploadToken: prepared.uploadToken },
            });
            expect(response.statusCode).toBe(200);
            const delivery = (
                await boss.findJobs<Job>(AdminJobQueue.AVATAR_REPLACE, {
                    data: { aggregateId: owner.id },
                })
            )[0]!.data;
            const before = await state(owner.id);
            const auditBefore = await evidence(owner.id, AdminAuditAction.ADMIN_AVATAR_FINALIZED);
            const auditSpy = vi
                .spyOn(app.get<IAuditPort>(TOKEN_AUDIT_PORT), 'record')
                .mockRejectedValueOnce(new DependencyUnavailableException());
            await expect(app.get(AdminAvatarReplaceConsumer).consume(delivery)).rejects.toMatchObject({
                kind: ExceptionKind.DEPENDENCY_UNAVAILABLE,
            });
            expect(await state(owner.id)).toEqual(before);
            expect(await evidence(owner.id, AdminAuditAction.ADMIN_AVATAR_FINALIZED)).toEqual(auditBefore);
            expect(await fixture.storage.headObject(previous)).toMatchObject({ sizeBytes: 4 });
            expect(await fixture.storage.headObject(prepared.destinationKey)).toMatchObject({ sizeBytes: 4 });
            auditSpy.mockRestore();
            const copy = vi.spyOn(fixture.storage, 'copyObject');
            vi.spyOn(fixture.storage, 'deleteObject').mockRejectedValueOnce(new DependencyUnavailableException());
            await expect(app.get(AdminAvatarReplaceConsumer).consume(delivery)).rejects.toMatchObject({
                kind: ExceptionKind.DEPENDENCY_UNAVAILABLE,
            });
            expect((await state(owner.id)).avatarKey).toBe(prepared.destinationKey);
            await app.get(AdminAvatarReplaceConsumer).consume(delivery);
            expect(copy).not.toHaveBeenCalled();
            expect(await evidence(owner.id, AdminAuditAction.ADMIN_AVATAR_FINALIZED)).toHaveLength(
                auditBefore.length + 1,
            );
            for (const key of [previous, prepared.sourceKey]) {
                await expect(fixture.storage.headObject(key)).rejects.toMatchObject({
                    kind: ExceptionKind.RESOURCE_NOT_FOUND,
                });
            }
        });

        it('commits one concurrent replacement from the same account version', async () => {
            const owner = await account();
            const first = await profileUpload(owner);
            const second = await profileUpload(owner);
            const before = await state(owner.id);
            const headObject = fixture.storage.headObject.bind(fixture.storage);
            let arrivals = 0;
            let release: () => void = () => {};
            const ready = new Promise<void>((resolve) => {
                release = resolve;
            });
            vi.spyOn(fixture.storage, 'headObject').mockImplementation(async (key) => {
                const object = await headObject(key);
                if (key === first.sourceKey || key === second.sourceKey) {
                    if (++arrivals === 2) {
                        release();
                    }
                    await ready;
                }
                return object;
            });
            const responses = await Promise.all(
                [first, second].map((prepared) =>
                    app.inject({
                        method: 'PATCH',
                        url: '/api/v1/admin/me',
                        headers: owner.headers,
                        payload: { avatar, uploadToken: prepared.uploadToken },
                    }),
                ),
            );
            expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
            expect((await state(owner.id)).version).toBe(before.version + 1);
            expect(await jobs(owner.id, AdminJobQueue.AVATAR_REPLACE)).toHaveLength(1);
            expect(await evidence(owner.id, AdminAuditAction.ADMIN_UPDATED)).toHaveLength(1);
        });

        it('retains pending and previous avatars after soft deletion', async () => {
            const owner = await account();
            const previous = (await state(owner.id)).avatarKey!;
            const prepared = await profileUpload(owner);
            const response = await app.inject({
                method: 'PATCH',
                url: '/api/v1/admin/me',
                headers: owner.headers,
                payload: { avatar, uploadToken: prepared.uploadToken },
            });
            expect(response.statusCode).toBe(200);
            const delivery = (
                await boss.findJobs<Job>(AdminJobQueue.AVATAR_REPLACE, {
                    data: { aggregateId: owner.id },
                })
            )[0]!.data;
            await database.update(admin).set({ deletedAt: new Date() }).where(eq(admin.id, owner.id));
            const before = await state(owner.id);
            await app.get(AdminAvatarReplaceConsumer).consume(delivery);
            expect(await state(owner.id)).toEqual(before);
            expect(await fixture.storage.headObject(previous)).toMatchObject({ sizeBytes: 4 });
            expect(await fixture.storage.headObject(prepared.sourceKey)).toMatchObject({ sizeBytes: 4 });
        });

        it.each(['pending', 'permanent'] as const)(
            'protects a reselected %s avatar from a superseded replacement',
            async (selection) => {
                const owner = await account();
                const first = await profileUpload(owner);
                const second = await profileUpload(owner);
                const patch = (uploadToken: string) =>
                    app.inject({
                        method: 'PATCH',
                        url: '/api/v1/admin/me',
                        headers: owner.headers,
                        payload: { avatar, uploadToken },
                    });

                expect((await patch(first.uploadToken)).statusCode).toBe(200);
                expect((await patch(second.uploadToken)).statusCode).toBe(200);
                // A proof can select its avatar again after another version supersedes it.
                expect((await patch(first.uploadToken)).statusCode).toBe(200);

                const deliveries = await boss.findJobs<Job>(AdminJobQueue.AVATAR_REPLACE, {
                    data: { aggregateId: owner.id },
                });
                const stale = deliveries.find((job) => job.data.deliveryId === second.deliveryId)!;
                expect(stale.data.payload).toEqual({ previousAvatarId: first.deliveryId });

                const source = await fixture.storage.headObject(first.sourceKey);
                // Simulate a copy completed before its database transition commits.
                await fixture.storage.copyObject({
                    sourceKey: first.sourceKey,
                    destinationKey: first.destinationKey,
                    sourceEtag: source.etag,
                    contentType: source.contentType!,
                    cache: AVATAR_PERMANENT_CACHE_POLICY,
                });

                if (selection === 'permanent') {
                    const current = deliveries.find((job) => job.data.deliveryId === first.deliveryId)!;
                    await app.get(AdminAvatarReplaceConsumer).consume(current.data);
                }

                const before = await state(owner.id);
                const auditBefore = await evidence(owner.id, AdminAuditAction.ADMIN_AVATAR_FINALIZED);
                await app.get(AdminAvatarReplaceConsumer).consume(stale.data);

                expect(await state(owner.id)).toEqual(before);
                expect(await evidence(owner.id, AdminAuditAction.ADMIN_AVATAR_FINALIZED)).toEqual(auditBefore);
                expect(await fixture.storage.headObject(first.destinationKey)).toMatchObject({ sizeBytes: 4 });
                if (selection === 'pending') {
                    expect(await fixture.storage.headObject(first.sourceKey)).toMatchObject({ sizeBytes: 4 });
                } else {
                    await expect(fixture.storage.headObject(first.sourceKey)).rejects.toMatchObject({
                        kind: ExceptionKind.RESOURCE_NOT_FOUND,
                    });
                }
                for (const key of [second.sourceKey, second.destinationKey]) {
                    await expect(fixture.storage.headObject(key)).rejects.toMatchObject({
                        kind: ExceptionKind.RESOURCE_NOT_FOUND,
                    });
                }
            },
        );

        it('preserves a newer pending selection across stale delivery and rejects proof replay', async () => {
            const owner = await account();
            const first = await profileUpload(owner);
            const patch = (uploadToken: string) =>
                app.inject({
                    method: 'PATCH',
                    url: '/api/v1/admin/me',
                    headers: owner.headers,
                    payload: { avatar, uploadToken },
                });
            expect((await patch(first.uploadToken)).statusCode).toBe(200);
            expect((await patch(first.uploadToken)).statusCode).toBe(409);
            const second = await profileUpload(owner);
            expect((await patch(second.uploadToken)).statusCode).toBe(200);
            const deliveries = await boss.findJobs<Job>(AdminJobQueue.AVATAR_REPLACE, {
                data: { aggregateId: owner.id },
            });
            const firstJob = deliveries.find((job) => job.data.deliveryId === first.deliveryId)!;
            const secondJob = deliveries.find((job) => job.data.deliveryId === second.deliveryId)!;
            const before = await state(owner.id);
            await app.get(AdminAvatarReplaceConsumer).consume(firstJob.data);
            expect(await state(owner.id)).toEqual(before);
            expect(await fixture.storage.headObject(second.sourceKey)).toMatchObject({ sizeBytes: 4 });
            await expect(fixture.storage.headObject(first.sourceKey)).rejects.toMatchObject({
                kind: ExceptionKind.RESOURCE_NOT_FOUND,
            });
            await app.get(AdminAvatarReplaceConsumer).consume(secondJob.data);
            expect((await state(owner.id)).avatarKey).toBe(second.destinationKey);
            expect((await patch(second.uploadToken)).statusCode).toBe(409);
            expect((await patch(first.uploadToken)).statusCode).toBe(400);
            expect(await evidence(owner.id, AdminAuditAction.ADMIN_UPDATED)).toHaveLength(2);
        });
    });
});
