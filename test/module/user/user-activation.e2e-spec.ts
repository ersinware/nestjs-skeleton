/**
 * @file user-activation.e2e-spec.ts
 * @description Exercises public activation through production HTTP wiring and real PostgreSQL, pg-boss, and Redis.
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { LightMyRequestResponse } from 'fastify';
import type Redis from 'ioredis';
import { PgBoss } from 'pg-boss';
import { TOKEN_CACHE_PORT, type ICachePort } from 'src/core/cache';
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
import { admin } from 'src/module/admin/infrastructure/admin.schema';
import { FinalizeUserAvatarCommand } from 'src/module/user/application/command/finalize-user-avatar/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { UserActivationQueue } from 'src/module/user/application/queue/user-activation.queue';
import { UserAvatarFinalizeQueue } from 'src/module/user/application/queue/user-avatar-finalize.queue';
import { UserAvatarReplaceQueue } from 'src/module/user/application/queue/user-avatar-replace.queue';
import { UserCacheQueue } from 'src/module/user/application/queue/user-cache.queue';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';
import { buildUserPendingAvatarKey, buildUserPermanentAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { UserUploadPurpose } from 'src/module/user/domain/user-upload-purpose.enum';
import { user } from 'src/module/user/infrastructure/user.schema';
import { UserAuditAction } from 'src/module/user/shared/user-audit';
import { AVATAR_PERMANENT_CACHE_POLICY, type AvatarUploadDescriptor } from 'src/shared/domain/avatar';
import { PrincipalType } from 'src/shared/domain/principal';
import { DependencyUnavailableException, ExceptionKind } from 'src/shared/exception';
import { createStorageTestFixture, type StorageTestFixture } from 'test/shared/storage-test.factory';
import { createTestApp } from 'test/shared/test-app.factory';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe('User registration and activation', () => {
    let app: NestFastifyApplication;
    let storageFixture: StorageTestFixture;
    const objectKeys = new Set<string>();
    let database: NodePgDatabase;
    let boss: PgBoss;
    let tokenPort: ITokenPort;
    let sessionPort: ISessionPort;
    let auditPort: IAuditPort;
    let jobWriterPort: IJobQueueWriterPort;
    let hashingPort: IHashingPort;
    const adminIds: string[] = [];
    const ids: string[] = [];
    const sendEmail = vi.fn<IEmailerPort['sendEmail']>();
    const password = 'Activation-Phase8!123';
    const avatar: AvatarUploadDescriptor = { sizeBytes: 4, contentType: 'image/png' };

    beforeAll(async () => {
        storageFixture = await createStorageTestFixture();
        app = await createTestApp({
            overrides: [
                { provide: TOKEN_EMAILER_PORT, useValue: { sendEmail } },
                { provide: TOKEN_STORAGE_PORT, useValue: storageFixture.storage },
            ],
        });
        database = app.get(TOKEN_DATABASE_CLIENT);
        boss = app.get(TOKEN_JOB_QUEUE_CLIENT);
        tokenPort = app.get(TOKEN_TOKEN_PORT);
        sessionPort = app.get(TOKEN_SESSION_PORT);
        auditPort = app.get(TOKEN_AUDIT_PORT);
        jobWriterPort = app.get(TOKEN_JOB_QUEUE_WRITER_PORT);
        hashingPort = app.get(TOKEN_HASHING_PORT);
        for (const queue of await boss.getQueues()) {
            await boss.offWork(queue.name);
        }
    }, 30_000);

    afterAll(async () => {
        if (!app) {
            return;
        }
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
            await database.delete(user).where(eq(user.id, id));
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
        for (const id of adminIds) {
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
        for (const id of ids) {
            await app.get<ICachePort>(TOKEN_CACHE_PORT).delete(CacheKeys.userById(id));
        }
        await app.close();
        for (const key of objectKeys) {
            await storageFixture.storage.deleteObject(key);
        }
        await storageFixture.close();
    }, 30_000);

    function data(response: LightMyRequestResponse): Record<string, unknown> {
        return (JSON.parse(response.body) as { data: Record<string, unknown> }).data;
    }

    async function prepareRegistration(email = `${uuidv7()}@example.test`, upload = true, body = 'test') {
        const form = { email, name: 'Activation Test', password, avatar: { sizeBytes: 4, contentType: 'image/png' } };
        const response = await app.inject({ method: 'POST', url: '/api/v1/user/registration/initiate', payload: form });
        expect(response.statusCode).toBe(200);
        const plan = data(response) as {
            uploadToken: string;
            request: { url: string; headers: Record<string, string> };
        };
        const claims = await tokenPort.verifyUploadToken(plan.uploadToken, UserUploadPurpose.REGISTRATION);
        ids.push(claims.sub);
        objectKeys.add(claims.fileKey);
        if (upload) {
            const put = await fetch(plan.request.url, {
                method: 'PUT',
                headers: plan.request.headers,
                body: Buffer.from(body),
            });
            expect(put.ok).toBe(true);
        }
        return { ...form, uploadToken: plan.uploadToken };
    }

    async function register() {
        const payload = await prepareRegistration();
        const response = await app.inject({ method: 'POST', url: '/api/v1/user/registration/complete', payload });
        expect(response.statusCode).toBe(204);
        expect(response.body).toBe('');
        const [row] = await database.select().from(user).where(eq(user.email, payload.email));
        expect(row?.activationId).toBeTruthy();
        return row!;
    }

    async function proof(row: typeof user.$inferSelect) {
        return tokenPort.generateActivationToken({
            sub: row.id,
            jti: row.activationId!,
            exp: Math.floor(row.activationExpiresAt!.getTime() / 1000),
            activationRevocationVersion: row.activationRevocationVersion!,
        });
    }

    async function jobs(id: string, queue = UserJobQueue.ACTIVATION) {
        return boss.findJobs<Job>(queue, { data: { aggregateId: id } });
    }

    async function actions(id: string) {
        return database.select().from(audit).where(eq(audit.targetId, id));
    }

    it('validates public registration, resend, and activation bodies before mutation', async () => {
        const email = `${uuidv7()}@example.test`;
        const invalid = [
            { url: '/api/v1/user/registration/complete', payload: { email, name: 'Activation Test' } },
            {
                url: '/api/v1/user/registration/complete',
                payload: { email, name: 'Activation Test', password, extra: true },
            },
            ...[
                { sizeBytes: 0, contentType: 'image/png' },
                { sizeBytes: 5 * 1024 * 1024 + 1, contentType: 'image/png' },
                { sizeBytes: 4, contentType: 'image/svg+xml' },
                { sizeBytes: 4, contentType: 'image/png', extra: true },
            ].map((avatar) => ({
                url: '/api/v1/user/registration/initiate',
                payload: { email, name: 'Activation Test', password, avatar },
            })),
            { url: '/api/v1/user/activation/resend', payload: { email: 'invalid' } },
            { url: '/api/v1/user/activation/complete', payload: { token: 'not-a-jwt', password } },
        ];
        for (const request of invalid) {
            const response = await app.inject({ method: 'POST', ...request });
            expect(response.statusCode).toBe(400);
        }
        expect(await database.select().from(user).where(eq(user.email, email))).toEqual([]);
    });

    it('preserves the admin login token-only response', async () => {
        const id = uuidv7();
        const email = `${id}@example.test`;
        adminIds.push(id);
        await database.insert(admin).values({
            id,
            email,
            name: 'Active Admin',
            password: await hashingPort.hash(password),
        });
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/admin/login',
            payload: { email, password },
        });
        expect(response.statusCode).toBe(200);
        expect(Object.keys(data(response)).sort()).toEqual(['accessToken', 'refreshToken']);
    });

    it('rolls back a registration when audit persistence fails', async () => {
        const email = `${uuidv7()}@example.test`;
        const payload = await prepareRegistration(email);
        vi.spyOn(auditPort, 'record').mockRejectedValueOnce(new DependencyUnavailableException());
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/user/registration/complete',
            payload,
        });
        expect(response.statusCode).toBe(503);
        expect(await database.select().from(user).where(eq(user.email, email))).toEqual([]);
    });

    it('rolls back a registration when the activation job is not accepted', async () => {
        const email = `${uuidv7()}@example.test`;
        const payload = await prepareRegistration(email);
        vi.spyOn(jobWriterPort, 'enqueue').mockRejectedValueOnce(new DependencyUnavailableException());
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/user/registration/complete',
            payload,
        });
        expect(response.statusCode).toBe(503);
        expect(await database.select().from(user).where(eq(user.email, email))).toEqual([]);
    });

    it('rejects pending refresh even if a signed credential is presented', async () => {
        const row = await register();
        const pair = await tokenPort.generateTokens({ id: row.id, type: PrincipalType.USER, permissions: [] }, 0);
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/refresh',
            payload: { refreshToken: pair.refreshToken },
        });
        expect(response.statusCode).toBe(401);
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBe(row.activationId);
    });

    it('commits one pending account, one job, and one audit; duplicate registration is 409', async () => {
        const row = await register();
        expect(row.activationExpiresAt!.getTime() - Date.now()).toBeGreaterThan(3 * 24 * 60 * 60 * 1000 - 5_000);
        expect(await jobs(row.id)).toHaveLength(1);
        expect(
            (await actions(row.id)).filter((entry) => entry.action === String(UserAuditAction.USER_REGISTERED)),
        ).toHaveLength(1);

        const duplicate = await app.inject({
            method: 'POST',
            url: '/api/v1/user/registration/initiate',
            payload: { email: row.email, name: 'Other', password, avatar: { sizeBytes: 4, contentType: 'image/png' } },
        });
        expect(duplicate.statusCode).toBe(409);
        expect(await jobs(row.id)).toHaveLength(1);
        expect(await database.select().from(user).where(eq(user.email, row.email))).toHaveLength(1);
    });

    it('commits only one account, job, and registration audit for concurrent duplicate emails', async () => {
        const email = `${uuidv7()}@example.test`;
        const payload = await prepareRegistration(email);
        const otherPayload = await prepareRegistration(email);
        const responses = await Promise.all([
            app.inject({ method: 'POST', url: '/api/v1/user/registration/complete', payload }),
            app.inject({ method: 'POST', url: '/api/v1/user/registration/complete', payload: otherPayload }),
        ]);
        expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 409]);
        const rows = await database.select().from(user).where(eq(user.email, email));
        expect(rows).toHaveLength(1);
        ids.push(rows[0]!.id);
        expect(await jobs(rows[0]!.id)).toHaveLength(1);
        expect(
            (await actions(rows[0]!.id)).filter((entry) => entry.action === String(UserAuditAction.USER_REGISTERED)),
        ).toHaveLength(1);
    });

    it('rejects missing uploads and changed form bindings without creating accounts', async () => {
        const payload = await prepareRegistration(undefined, false);
        for (const candidate of [payload, { ...payload, name: 'Changed' }]) {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/user/registration/complete',
                payload: candidate,
            });
            expect(response.statusCode).toBe(400);
        }
        expect(await database.select().from(user).where(eq(user.email, payload.email))).toEqual([]);
    });

    it('checks actual object size and type before committing registration', async () => {
        const wrongSize = await prepareRegistration(undefined, true, 'wrong-size');
        const wrongType = await prepareRegistration(undefined, false);
        const claims = await tokenPort.verifyUploadToken(wrongType.uploadToken, UserUploadPurpose.REGISTRATION);
        const plan = await storageFixture.storage.initiateUpload({
            key: claims.fileKey,
            sizeBytes: 4,
            contentType: 'image/jpeg',
            cache: { visibility: 'no-store' },
            deadline: new Date(Date.now() + 300_000),
        });
        if (plan.mode !== 'single') throw new Error('Expected a single avatar upload.');
        const put = await fetch(plan.request.url, {
            method: 'PUT',
            headers: plan.request.headers,
            body: Buffer.from('test'),
        });
        expect(put.ok).toBe(true);
        for (const payload of [wrongSize, wrongType]) {
            const response = await app.inject({ method: 'POST', url: '/api/v1/user/registration/complete', payload });
            expect(response.statusCode).toBe(400);
            expect(await database.select().from(user).where(eq(user.email, payload.email))).toEqual([]);
        }
    });

    it('preserves a committed account and its jobs on upload token replay', async () => {
        const payload = await prepareRegistration();
        const responses = await Promise.all([
            app.inject({ method: 'POST', url: '/api/v1/user/registration/complete', payload }),
            app.inject({ method: 'POST', url: '/api/v1/user/registration/complete', payload }),
        ]);
        expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 409]);
        const [row] = await database.select().from(user).where(eq(user.email, payload.email));
        const replay = await app.inject({ method: 'POST', url: '/api/v1/user/registration/complete', payload });
        expect(replay.statusCode).toBe(409);
        expect((await database.select().from(user).where(eq(user.id, row!.id)))[0]).toEqual(row);
        expect(await jobs(row!.id)).toHaveLength(1);
        expect(await boss.findJobs<Job>(UserJobQueue.AVATAR_FINALIZE, { data: { aggregateId: row!.id } })).toHaveLength(
            1,
        );
    });

    it('recovers a copied avatar after transaction rollback and repeats cleanup without recopying', async () => {
        const row = await register();
        const [job] = await boss.findJobs<Job>(UserJobQueue.AVATAR_FINALIZE, { data: { aggregateId: row.id } });
        const destination = buildUserPermanentAvatarKey(row.id, job!.data.deliveryId);
        const source = buildUserPendingAvatarKey(row.id, row.id);
        objectKeys.add(destination);
        const pipeline = app.get(CommandPipeline);
        const command = new FinalizeUserAvatarCommand(row.id, job!.data.deliveryId);
        vi.spyOn(auditPort, 'record').mockRejectedValueOnce(new DependencyUnavailableException());
        await expect(pipeline.execute(command)).rejects.toBeInstanceOf(DependencyUnavailableException);
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.avatarKey).toBe(source);
        expect(await storageFixture.storage.headObject(source)).toMatchObject({ sizeBytes: 4 });
        const copy = vi.spyOn(storageFixture.storage, 'copyObject');
        await pipeline.execute(command);
        await pipeline.execute(command);
        expect(copy).not.toHaveBeenCalled();
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.avatarKey).toBe(destination);
        expect(await storageFixture.storage.headObject(destination)).toMatchObject({
            sizeBytes: 4,
            contentType: 'image/png',
        });
        expect(await storageFixture.readCacheControl(destination)).toBe(
            'public, max-age=31536000, s-maxage=31536000, immutable',
        );
        expect(
            (await actions(row.id)).filter((entry) => entry.action === String(UserAuditAction.USER_AVATAR_FINALIZED)),
        ).toHaveLength(1);
        await expect(storageFixture.storage.headObject(source)).rejects.toMatchObject({ kind: 'RESOURCE_NOT_FOUND' });
    });

    it('retries cleanup after the permanent key commits without duplicating its audit', async () => {
        const row = await register();
        const [job] = await boss.findJobs<Job>(UserJobQueue.AVATAR_FINALIZE, { data: { aggregateId: row.id } });
        const destination = buildUserPermanentAvatarKey(row.id, job!.data.deliveryId);
        objectKeys.add(destination);
        const command = new FinalizeUserAvatarCommand(row.id, job!.data.deliveryId);
        const pipeline = app.get(CommandPipeline);
        vi.spyOn(storageFixture.storage, 'deleteObject').mockRejectedValueOnce(new DependencyUnavailableException());
        await expect(pipeline.execute(command)).rejects.toMatchObject({ kind: 'DEPENDENCY_UNAVAILABLE' });
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.avatarKey).toBe(destination);
        const copy = vi.spyOn(storageFixture.storage, 'copyObject');
        await pipeline.execute(command);
        expect(copy).not.toHaveBeenCalled();
        expect(
            (await actions(row.id)).filter((entry) => entry.action === String(UserAuditAction.USER_AVATAR_FINALIZED)),
        ).toHaveLength(1);
        await expect(
            storageFixture.storage.headObject(buildUserPendingAvatarKey(row.id, row.id)),
        ).rejects.toMatchObject({
            kind: 'RESOURCE_NOT_FOUND',
        });
    });

    it('keeps missing and banned logins at the ordinary 401 response', async () => {
        const row = await register();
        const login = (email: string) =>
            app.inject({
                method: 'POST',
                url: '/api/v1/auth/user/login',
                payload: { email, password },
            });
        expect((await login(`${uuidv7()}@example.test`)).statusCode).toBe(401);
        await database
            .update(user)
            .set({ isBanned: true, version: row.version + 1 })
            .where(eq(user.id, row.id));
        expect((await login(row.email)).statusCode).toBe(401);
    });

    it('gates login, delivers fixed proof, activates once, and then permits login', async () => {
        const row = await register();
        const login = (loginPassword: string) =>
            app.inject({
                method: 'POST',
                url: '/api/v1/auth/user/login',
                payload: { email: row.email, password: loginPassword },
            });
        expect((await login('WrongPass-12345!')).statusCode).toBe(401);
        expect(data(await login(password))).toEqual({ session: 'activation_required' });

        const delivery = (await jobs(row.id))[0]!;
        sendEmail.mockResolvedValue(undefined);
        await app.get(UserActivationQueue).consume(delivery.data);
        expect(sendEmail).toHaveBeenCalledOnce();
        expect(sendEmail.mock.calls[0]![0].to).toBe(row.email);
        const token = await proof(row);
        const wrongPassword = await app.inject({
            method: 'POST',
            url: '/api/v1/user/activation/complete',
            payload: { token, password: 'WrongPass-12345!' },
        });
        expect(wrongPassword.statusCode).toBe(400);
        expect((await actions(row.id)).filter((entry) => entry.action === 'USER_ACTIVATION_FAILED')).toHaveLength(1);
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBe(row.activationId);

        const activated = await app.inject({
            method: 'POST',
            url: '/api/v1/user/activation/complete',
            payload: { token, password },
        });
        expect(activated.statusCode).toBe(200);
        expect(Object.keys(data(activated)).sort()).toEqual(['accessToken', 'refreshToken', 'session']);
        expect(data(activated)['session']).toBe('created');
        expect(typeof data(activated)['accessToken']).toBe('string');
        expect(typeof data(activated)['refreshToken']).toBe('string');
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBeNull();
        expect(
            (
                await app.inject({
                    method: 'POST',
                    url: '/api/v1/user/activation/complete',
                    payload: { token, password },
                })
            ).statusCode,
        ).toBe(409);
        expect(data(await login(password))['session']).toBe('created');
        expect(
            (await actions(row.id)).filter((entry) => entry.action === String(UserAuditAction.USER_ACTIVATED)),
        ).toHaveLength(1);
    });

    it('rejects validly signed proof with another request identity or revocation snapshot', async () => {
        const row = await register();
        const valid = {
            sub: row.id,
            jti: row.activationId!,
            exp: Math.floor(row.activationExpiresAt!.getTime() / 1000),
            activationRevocationVersion: row.activationRevocationVersion!,
        };
        const invalid = [
            { ...valid, jti: uuidv7() },
            { ...valid, exp: valid.exp - 1 },
            { ...valid, activationRevocationVersion: valid.activationRevocationVersion + 1 },
        ];
        for (const claims of invalid) {
            const token = await tokenPort.generateActivationToken(claims);
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/user/activation/complete',
                payload: { token, password },
            });
            expect(response.statusCode).toBe(400);
        }
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBe(row.activationId);
        expect(
            (await actions(row.id)).filter((entry) => entry.action === String(UserAuditAction.USER_ACTIVATED)),
        ).toHaveLength(0);
    });

    it('replaces valid and expired proofs, invalidating prior links and deliveries', async () => {
        const row = await register();
        const oldToken = await proof(row);
        const originalJob = (await jobs(row.id))[0]!;
        const resend = () =>
            app.inject({ method: 'POST', url: '/api/v1/user/activation/resend', payload: { email: row.email } });
        expect((await resend()).statusCode).toBe(204);
        const [replaced] = await database.select().from(user).where(eq(user.id, row.id));
        expect(replaced!.activationId).not.toBe(row.activationId);
        expect(replaced!.activationExpiresAt!.getTime()).toBeGreaterThanOrEqual(row.activationExpiresAt!.getTime());
        expect(await jobs(row.id)).toHaveLength(2);
        sendEmail.mockResolvedValue(undefined);
        await app.get(UserActivationQueue).consume(originalJob.data);
        expect(sendEmail).not.toHaveBeenCalled();
        const replacementJob = (await jobs(row.id)).find((job) => job.data.deliveryId === replaced!.activationId)!;
        await app.get(UserActivationQueue).consume(replacementJob.data);
        expect(sendEmail).toHaveBeenCalledOnce();
        expect(sendEmail.mock.calls[0]![1]).toEqual({
            queueName: UserJobQueue.ACTIVATION,
            deliveryId: replaced!.activationId,
        });
        expect(
            (
                await app.inject({
                    method: 'POST',
                    url: '/api/v1/user/activation/complete',
                    payload: { token: oldToken, password },
                })
            ).statusCode,
        ).toBe(400);

        await database
            .update(user)
            .set({ activationExpiresAt: new Date(Date.now() - 1_000) })
            .where(eq(user.id, row.id));
        expect((await resend()).statusCode).toBe(204);
        const [renewed] = await database.select().from(user).where(eq(user.id, row.id));
        expect(renewed!.activationId).not.toBe(replaced!.activationId);
        expect(renewed!.activationExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 3 * 24 * 60 * 60 * 1000 - 5_000);
        expect(await jobs(row.id)).toHaveLength(3);
        expect(
            (await actions(row.id)).filter(
                (entry) => entry.action === String(UserAuditAction.USER_ACTIVATION_REQUESTED),
            ),
        ).toHaveLength(2);
        expect(
            (
                await app.inject({
                    method: 'POST',
                    url: '/api/v1/user/activation/complete',
                    payload: { token: await proof(row), password },
                })
            ).statusCode,
        ).toBe(400);
    });

    it('commits only one of two expired resends loaded from the same version', async () => {
        const row = await register();
        await database
            .update(user)
            .set({ activationExpiresAt: new Date(Date.now() - 1_000) })
            .where(eq(user.id, row.id));
        const writer = app.get<IUserWriterPort>(TOKEN_USER_WRITER_PORT);
        const originalLoad = writer.loadByEmail.bind(writer);
        let loaded = 0;
        let release!: () => void;
        const bothLoaded = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.spyOn(writer, 'loadByEmail').mockImplementation(async (email) => {
            const aggregate = await originalLoad(email);
            if (++loaded === 2) {
                release();
            }
            await bothLoaded;
            return aggregate;
        });
        const payload = { email: row.email };
        const responses = await Promise.all([
            app.inject({ method: 'POST', url: '/api/v1/user/activation/resend', payload }),
            app.inject({ method: 'POST', url: '/api/v1/user/activation/resend', payload }),
        ]);
        expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 409]);
        expect(await jobs(row.id)).toHaveLength(2);
        expect(
            (await actions(row.id)).filter(
                (entry) => entry.action === String(UserAuditAction.USER_ACTIVATION_REQUESTED),
            ),
        ).toHaveLength(1);
    });

    it('returns indistinguishable 204 for unknown and active accounts', async () => {
        const row = await register();
        const request = (email: string) =>
            app.inject({ method: 'POST', url: '/api/v1/user/activation/resend', payload: { email } });
        expect((await request(`${uuidv7()}@example.test`)).statusCode).toBe(204);
        await app.inject({
            method: 'POST',
            url: '/api/v1/user/activation/complete',
            payload: { token: await proof(row), password },
        });
        expect((await request(row.email)).statusCode).toBe(204);
        expect(await jobs(row.id)).toHaveLength(1);
    });

    it('allows only one of two concurrent activations to consume the same proof', async () => {
        const row = await register();
        const token = await proof(row);
        const responses = await Promise.all([
            app.inject({ method: 'POST', url: '/api/v1/user/activation/complete', payload: { token, password } }),
            app.inject({ method: 'POST', url: '/api/v1/user/activation/complete', payload: { token, password } }),
        ]);
        expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
        expect(
            (await actions(row.id)).filter((entry) => entry.action === String(UserAuditAction.USER_ACTIVATED)),
        ).toHaveLength(1);
    });

    it('allows only one of activation and resend loaded from the same version to commit', async () => {
        const row = await register();
        const token = await proof(row);
        const writer = app.get<IUserWriterPort>(TOKEN_USER_WRITER_PORT);
        const originalLoad = writer.load.bind(writer);
        const originalLoadByEmail = writer.loadByEmail.bind(writer);
        let loaded = 0;
        let release!: () => void;
        const bothLoaded = new Promise<void>((resolve) => {
            release = resolve;
        });
        const waitForOther = async () => {
            if (++loaded === 2) {
                release();
            }
            await bothLoaded;
        };
        vi.spyOn(writer, 'load').mockImplementation(async (id) => {
            const aggregate = await originalLoad(id);
            await waitForOther();
            return aggregate;
        });
        vi.spyOn(writer, 'loadByEmail').mockImplementation(async (email) => {
            const aggregate = await originalLoadByEmail(email);
            await waitForOther();
            return aggregate;
        });
        const responses = await Promise.all([
            app.inject({ method: 'POST', url: '/api/v1/user/activation/complete', payload: { token, password } }),
            app.inject({ method: 'POST', url: '/api/v1/user/activation/resend', payload: { email: row.email } }),
        ]);
        expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(1);
        expect(responses.some((response) => response.statusCode === 200 || response.statusCode === 204)).toBe(true);
        const committed = (await actions(row.id)).filter(
            (entry) =>
                entry.action === String(UserAuditAction.USER_ACTIVATED) ||
                entry.action === String(UserAuditAction.USER_ACTIVATION_REQUESTED),
        );
        expect(committed).toHaveLength(1);
    });

    it.each(['banned', 'deleted', 'expired', 'revoked'] as const)(
        'skips %s activation deliveries',
        async (scenario) => {
            const row = await register();
            const delivery = (await jobs(row.id))[0]!;
            const changes = {
                banned: { isBanned: true },
                deleted: { deletedAt: new Date() },
                expired: { activationExpiresAt: new Date(Date.now() - 1_000) },
                revoked: { revocationVersion: row.revocationVersion + 1 },
            }[scenario];
            await database.update(user).set(changes).where(eq(user.id, row.id));
            sendEmail.mockClear();
            await app.get(UserActivationQueue).consume(delivery.data);
            expect(sendEmail).not.toHaveBeenCalled();
        },
    );

    it('does not deliver an expired or replaced activation job', async () => {
        const row = await register();
        const firstJob = (await jobs(row.id))[0]!;
        await database
            .update(user)
            .set({ activationExpiresAt: new Date(Date.now() - 1_000) })
            .where(eq(user.id, row.id));
        await app.inject({ method: 'POST', url: '/api/v1/user/activation/resend', payload: { email: row.email } });
        sendEmail.mockClear();
        await app.get(UserActivationQueue).consume(firstJob.data);
        expect(sendEmail).not.toHaveBeenCalled();
        const [current] = await database.select().from(user).where(eq(user.id, row.id));
        const currentJob = (await jobs(row.id)).find((job) => job.data.deliveryId === current!.activationId)!;
        await app.get(UserActivationQueue).consume(currentJob.data);
        expect(sendEmail).toHaveBeenCalledOnce();
    });

    it.each(['ban', 'delete'] as const)('rejects activation saved after a concurrent %s', async (scenario) => {
        const row = await register();
        const token = await proof(row);
        const originalVerify = hashingPort.verify.bind(hashingPort);
        let enter!: () => void;
        let release!: () => void;
        const entered = new Promise<void>((resolve) => {
            enter = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.spyOn(hashingPort, 'verify').mockImplementationOnce(async (hash, candidate) => {
            enter();
            await gate;
            return originalVerify(hash, candidate);
        });
        const request = app.inject({
            method: 'POST',
            url: '/api/v1/user/activation/complete',
            payload: { token, password },
        });
        await entered;
        try {
            await database
                .update(user)
                .set(
                    scenario === 'ban'
                        ? { isBanned: true, version: row.version + 1 }
                        : { deletedAt: new Date(), version: row.version + 1 },
                )
                .where(eq(user.id, row.id));
        } finally {
            release();
        }
        expect((await request).statusCode).toBe(409);
        const [after] = await database.select().from(user).where(eq(user.id, row.id));
        expect(after!.activationId).toBe(row.activationId);
        if (scenario === 'ban') {
            expect(after!.isBanned).toBe(true);
        } else {
            expect(after!.deletedAt).not.toBeNull();
        }
        expect(
            (await actions(row.id)).filter((entry) => entry.action === String(UserAuditAction.USER_ACTIVATED)),
        ).toHaveLength(0);
    });

    it('rolls back activation when its success audit cannot be persisted', async () => {
        const row = await register();
        const token = await proof(row);
        vi.spyOn(auditPort, 'record').mockRejectedValueOnce(new DependencyUnavailableException());
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/user/activation/complete',
            payload: { token, password },
        });
        expect(response.statusCode).toBe(503);
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBe(row.activationId);
        expect(
            (await actions(row.id)).filter((entry) => entry.action === String(UserAuditAction.USER_ACTIVATED)),
        ).toHaveLength(0);
    });

    it('keeps activation committed when token generation fails after commit', async () => {
        const row = await register();
        const token = await proof(row);
        vi.spyOn(tokenPort, 'generateTokens').mockRejectedValueOnce(new Error('unexpected signing failure'));
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/user/activation/complete',
            payload: { token, password },
        });
        expect(response.statusCode).toBe(500);
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBeNull();
        expect(
            (
                await app.inject({
                    method: 'POST',
                    url: '/api/v1/user/activation/complete',
                    payload: { token, password },
                })
            ).statusCode,
        ).toBe(409);
    });

    it('returns login_required after a recognized session outage without undoing activation', async () => {
        const row = await register();
        vi.spyOn(sessionPort, 'openSession').mockRejectedValueOnce(new DependencyUnavailableException());
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/user/activation/complete',
            payload: { token: await proof(row), password },
        });
        expect(response.statusCode).toBe(200);
        expect(data(response)).toEqual({ session: 'login_required' });
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBeNull();
    });

    it('propagates an unexpected session error after activation commits', async () => {
        const row = await register();
        vi.spyOn(sessionPort, 'openSession').mockRejectedValueOnce(new Error('unexpected session failure'));
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/user/activation/complete',
            payload: { token: await proof(row), password },
        });
        expect(response.statusCode).toBe(500);
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBeNull();
    });

    it('keeps activation committed when session registration is refused', async () => {
        const row = await register();
        vi.spyOn(sessionPort, 'openSession').mockResolvedValueOnce(false);
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/user/activation/complete',
            payload: { token: await proof(row), password },
        });
        expect(response.statusCode).toBe(200);
        expect(data(response)).toEqual({ session: 'login_required' });
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBeNull();
    });
    /**
     * Reads current persisted user state independently of projection caching.
     *
     * @param id Run-owned account identity
     * @returns Persisted account state
     */
    async function state(id: string): Promise<typeof user.$inferSelect> {
        return (await database.select().from(user).where(eq(user.id, id)))[0]!;
    }

    /**
     * Observes committed self-service and delivery evidence.
     *
     * @param id Run-owned account identity
     * @param action Expected audit action
     * @returns Matching durable audit records
     */
    async function evidence(id: string, action: string): Promise<(typeof audit.$inferSelect)[]> {
        return (
            await database
                .select()
                .from(audit)
                .where(or(eq(audit.actorId, id), eq(audit.targetId, id)))
        ).filter((entry) => entry.action === action);
    }
    describe('User profile avatar updates', () => {
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
         * Registers and activates a fresh account without bypassing session guards.
         *
         * @param finalizeInitial Whether to finish the initial avatar before profile updates
         * @returns Authenticated account scoped to this test run
         */
        async function account(finalizeInitial = true): Promise<ProfileAccount> {
            const initial = await register();
            const activated = await app.inject({
                method: 'POST',
                url: '/api/v1/user/activation/complete',
                payload: { token: await proof(initial), password },
            });
            expect(activated.statusCode).toBe(200);
            const initialJob = (
                await boss.findJobs<Job>(UserJobQueue.AVATAR_FINALIZE, { data: { aggregateId: initial.id } })
            )[0]!;
            objectKeys.add(buildUserPermanentAvatarKey(initial.id, initialJob.data.deliveryId));
            if (finalizeInitial) {
                await app.get(UserAvatarFinalizeQueue).consume(initialJob.data);
            }
            return {
                id: initial.id,
                headers: {
                    authorization: `Bearer ${activated.json<{ data: { accessToken: string } }>().data.accessToken}`,
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
                url: '/api/v1/user/me/avatar/initiate',
                headers: owner.headers,
                payload: { avatar, ...(name !== undefined && { name }) },
            });
            expect(response.statusCode).toBe(200);
            const plan = response.json<{
                data: { uploadToken: string; request: { url: string; headers: Record<string, string> } };
            }>().data;
            const claims = await tokenPort.verifyUploadToken(plan.uploadToken, UserUploadPurpose.PROFILE_AVATAR);
            const destinationKey = buildUserPermanentAvatarKey(owner.id, claims.jti);
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
                const beforeJobs = await jobs(owner.id, UserJobQueue.AVATAR_REPLACE);
                const name = scenario === 'avatar-only' ? undefined : 'Updated User';
                const upload = scenario === 'name-only' ? undefined : await profileUpload(owner, name);
                const response = await app.inject({
                    method: 'PATCH',
                    url: '/api/v1/user/me',
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
                expect(await evidence(owner.id, UserAuditAction.USER_UPDATED)).toHaveLength(1);
                expect(await jobs(owner.id, UserJobQueue.AVATAR_REPLACE)).toHaveLength(
                    beforeJobs.length + (upload ? 1 : 0),
                );
                if (upload) {
                    const delivery = (
                        await boss.findJobs<Job>(UserJobQueue.AVATAR_REPLACE, { data: { aggregateId: owner.id } })
                    ).find((job) => job.data.deliveryId === upload.deliveryId)!;
                    await app.get(UserAvatarReplaceQueue).consume(delivery.data);
                    await expect(storageFixture.storage.headObject(before.avatarKey)).rejects.toMatchObject({
                        kind: ExceptionKind.RESOURCE_NOT_FOUND,
                    });
                    expect((await state(owner.id)).avatarKey).toBe(upload.destinationKey);
                    expect(await storageFixture.readCacheControl(upload.destinationKey)).toBe(
                        'public, max-age=31536000, s-maxage=31536000, immutable',
                    );
                    await expect(storageFixture.storage.headObject(upload.sourceKey)).rejects.toMatchObject({
                        kind: ExceptionKind.RESOURCE_NOT_FOUND,
                    });
                }
            },
        );

        it('rejects empty, null, invalid, and unknown profile fields without writes', async () => {
            const owner = await account();
            const before = await state(owner.id);
            const beforeJobs = await jobs(owner.id, UserJobQueue.AVATAR_REPLACE);
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
                    url: '/api/v1/user/me',
                    headers: owner.headers,
                    payload,
                });
                expect(response.statusCode).toBe(400);
                expect(response.json<unknown>()).toMatchObject({ error: { statusCode: 400 } });
            }
            expect(await state(owner.id)).toEqual(before);
            expect(await jobs(owner.id, UserJobQueue.AVATAR_REPLACE)).toHaveLength(beforeJobs.length);
            expect(await evidence(owner.id, UserAuditAction.USER_UPDATED)).toEqual([]);
        });

        it.each(['expired', 'purpose', 'ownership', 'name-binding', 'missing-object'] as const)(
            'rejects %s before accepting a profile change',
            async (scenario) => {
                const owner = await account();
                const prepared = await profileUpload(owner, undefined, scenario !== 'missing-object');
                const before = await state(owner.id);
                const beforeJobs = await jobs(owner.id, UserJobQueue.AVATAR_REPLACE);
                let uploadToken = prepared.uploadToken;
                if (scenario === 'expired' || scenario === 'purpose' || scenario === 'ownership') {
                    const claims = await tokenPort.verifyUploadToken(uploadToken, UserUploadPurpose.PROFILE_AVATAR);
                    uploadToken = await tokenPort.generateUploadToken({
                        ...claims,
                        ...(scenario === 'expired' && { exp: Math.floor(Date.now() / 1000) - 1 }),
                        ...(scenario === 'purpose' && { purpose: UserUploadPurpose.REGISTRATION }),
                        ...(scenario === 'ownership' && { sub: uuidv7() }),
                    });
                }
                const response = await app.inject({
                    method: 'PATCH',
                    url: '/api/v1/user/me',
                    headers: owner.headers,
                    payload: {
                        ...(scenario === 'name-binding' && { name: 'Changed User' }),
                        avatar,
                        uploadToken,
                    },
                });
                expect(response.statusCode).toBe(scenario === 'ownership' ? 403 : 400);
                expect(await state(owner.id)).toEqual(before);
                expect(await jobs(owner.id, UserJobQueue.AVATAR_REPLACE)).toHaveLength(beforeJobs.length);
                expect(await evidence(owner.id, UserAuditAction.USER_UPDATED)).toEqual([]);
            },
        );

        it.each(['audit', 'enqueue'] as const)(
            'rolls back the combined profile and move job when %s fails',
            async (failure) => {
                const owner = await account();
                const prepared = await profileUpload(owner, 'Updated User');
                const before = await state(owner.id);
                const beforeJobs = await jobs(owner.id, UserJobQueue.AVATAR_REPLACE);
                if (failure === 'audit') {
                    const record = app.get<IAuditPort>(TOKEN_AUDIT_PORT);
                    const original = record.record.bind(record);
                    vi.spyOn(record, 'record').mockImplementation((entry, options) => {
                        if (entry.action === String(UserAuditAction.USER_UPDATED)) {
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
                    url: '/api/v1/user/me',
                    headers: owner.headers,
                    payload: { name: 'Updated User', avatar, uploadToken: prepared.uploadToken },
                });
                expect(response.statusCode).toBe(503);
                expect(await state(owner.id)).toEqual(before);
                expect(await jobs(owner.id, UserJobQueue.AVATAR_REPLACE)).toHaveLength(beforeJobs.length);
                expect(await evidence(owner.id, UserAuditAction.USER_UPDATED)).toEqual([]);
                expect(await storageFixture.storage.headObject(prepared.sourceKey)).toMatchObject({ sizeBytes: 4 });
            },
        );

        it('reuses a copied replacement after rollback and resumes cleanup after commit', async () => {
            const owner = await account();
            const previous = (await state(owner.id)).avatarKey;
            const prepared = await profileUpload(owner);
            const response = await app.inject({
                method: 'PATCH',
                url: '/api/v1/user/me',
                headers: owner.headers,
                payload: { avatar, uploadToken: prepared.uploadToken },
            });
            expect(response.statusCode).toBe(200);
            const delivery = (
                await boss.findJobs<Job>(UserJobQueue.AVATAR_REPLACE, {
                    data: { aggregateId: owner.id },
                })
            )[0]!.data;
            const before = await state(owner.id);
            const auditBefore = await evidence(owner.id, UserAuditAction.USER_AVATAR_FINALIZED);
            const auditSpy = vi
                .spyOn(app.get<IAuditPort>(TOKEN_AUDIT_PORT), 'record')
                .mockRejectedValueOnce(new DependencyUnavailableException());
            await expect(app.get(UserAvatarReplaceQueue).consume(delivery)).rejects.toMatchObject({
                kind: ExceptionKind.DEPENDENCY_UNAVAILABLE,
            });
            expect(await state(owner.id)).toEqual(before);
            expect(await evidence(owner.id, UserAuditAction.USER_AVATAR_FINALIZED)).toEqual(auditBefore);
            expect(await storageFixture.storage.headObject(previous)).toMatchObject({ sizeBytes: 4 });
            expect(await storageFixture.storage.headObject(prepared.destinationKey)).toMatchObject({ sizeBytes: 4 });
            auditSpy.mockRestore();
            const copy = vi.spyOn(storageFixture.storage, 'copyObject');
            vi.spyOn(storageFixture.storage, 'deleteObject').mockRejectedValueOnce(
                new DependencyUnavailableException(),
            );
            await expect(app.get(UserAvatarReplaceQueue).consume(delivery)).rejects.toMatchObject({
                kind: ExceptionKind.DEPENDENCY_UNAVAILABLE,
            });
            expect((await state(owner.id)).avatarKey).toBe(prepared.destinationKey);
            await app.get(UserAvatarReplaceQueue).consume(delivery);
            expect(copy).not.toHaveBeenCalled();
            expect(await evidence(owner.id, UserAuditAction.USER_AVATAR_FINALIZED)).toHaveLength(
                auditBefore.length + 1,
            );
            for (const key of [previous, prepared.sourceKey]) {
                await expect(storageFixture.storage.headObject(key)).rejects.toMatchObject({
                    kind: ExceptionKind.RESOURCE_NOT_FOUND,
                });
            }
        });

        it('commits one concurrent replacement from the same account version', async () => {
            const owner = await account();
            const first = await profileUpload(owner);
            const second = await profileUpload(owner);
            const before = await state(owner.id);
            const headObject = storageFixture.storage.headObject.bind(storageFixture.storage);
            let arrivals = 0;
            let release: () => void = () => {};
            const ready = new Promise<void>((resolve) => {
                release = resolve;
            });
            vi.spyOn(storageFixture.storage, 'headObject').mockImplementation(async (key) => {
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
                        url: '/api/v1/user/me',
                        headers: owner.headers,
                        payload: { avatar, uploadToken: prepared.uploadToken },
                    }),
                ),
            );
            expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
            expect((await state(owner.id)).version).toBe(before.version + 1);
            expect(await jobs(owner.id, UserJobQueue.AVATAR_REPLACE)).toHaveLength(1);
            expect(await evidence(owner.id, UserAuditAction.USER_UPDATED)).toHaveLength(1);
        });

        it('retains pending and previous avatars after soft deletion', async () => {
            const owner = await account();
            const previous = (await state(owner.id)).avatarKey;
            const prepared = await profileUpload(owner);
            const response = await app.inject({
                method: 'PATCH',
                url: '/api/v1/user/me',
                headers: owner.headers,
                payload: { avatar, uploadToken: prepared.uploadToken },
            });
            expect(response.statusCode).toBe(200);
            const delivery = (
                await boss.findJobs<Job>(UserJobQueue.AVATAR_REPLACE, {
                    data: { aggregateId: owner.id },
                })
            )[0]!.data;
            await database.update(user).set({ deletedAt: new Date() }).where(eq(user.id, owner.id));
            const before = await state(owner.id);
            await app.get(UserAvatarReplaceQueue).consume(delivery);
            expect(await state(owner.id)).toEqual(before);
            expect(await storageFixture.storage.headObject(previous)).toMatchObject({ sizeBytes: 4 });
            expect(await storageFixture.storage.headObject(prepared.sourceKey)).toMatchObject({ sizeBytes: 4 });
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
                        url: '/api/v1/user/me',
                        headers: owner.headers,
                        payload: { avatar, uploadToken },
                    });

                expect((await patch(first.uploadToken)).statusCode).toBe(200);
                expect((await patch(second.uploadToken)).statusCode).toBe(200);
                // A proof can select its avatar again after another version supersedes it.
                expect((await patch(first.uploadToken)).statusCode).toBe(200);

                const deliveries = await boss.findJobs<Job>(UserJobQueue.AVATAR_REPLACE, {
                    data: { aggregateId: owner.id },
                });
                const stale = deliveries.find((job) => job.data.deliveryId === second.deliveryId)!;
                expect(stale.data.payload).toEqual({ previousAvatarId: first.deliveryId });

                const source = await storageFixture.storage.headObject(first.sourceKey);
                // Simulate a copy completed before its database transition commits.
                await storageFixture.storage.copyObject({
                    sourceKey: first.sourceKey,
                    destinationKey: first.destinationKey,
                    sourceEtag: source.etag,
                    contentType: source.contentType!,
                    cache: AVATAR_PERMANENT_CACHE_POLICY,
                });

                if (selection === 'permanent') {
                    const current = deliveries.find((job) => job.data.deliveryId === first.deliveryId)!;
                    await app.get(UserAvatarReplaceQueue).consume(current.data);
                }

                const before = await state(owner.id);
                const auditBefore = await evidence(owner.id, UserAuditAction.USER_AVATAR_FINALIZED);
                await app.get(UserAvatarReplaceQueue).consume(stale.data);

                expect(await state(owner.id)).toEqual(before);
                expect(await evidence(owner.id, UserAuditAction.USER_AVATAR_FINALIZED)).toEqual(auditBefore);
                expect(await storageFixture.storage.headObject(first.destinationKey)).toMatchObject({ sizeBytes: 4 });
                if (selection === 'pending') {
                    expect(await storageFixture.storage.headObject(first.sourceKey)).toMatchObject({ sizeBytes: 4 });
                } else {
                    await expect(storageFixture.storage.headObject(first.sourceKey)).rejects.toMatchObject({
                        kind: ExceptionKind.RESOURCE_NOT_FOUND,
                    });
                }
                for (const key of [second.sourceKey, second.destinationKey]) {
                    await expect(storageFixture.storage.headObject(key)).rejects.toMatchObject({
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
                    url: '/api/v1/user/me',
                    headers: owner.headers,
                    payload: { avatar, uploadToken },
                });
            expect((await patch(first.uploadToken)).statusCode).toBe(200);
            expect((await patch(first.uploadToken)).statusCode).toBe(409);
            const second = await profileUpload(owner);
            expect((await patch(second.uploadToken)).statusCode).toBe(200);
            const deliveries = await boss.findJobs<Job>(UserJobQueue.AVATAR_REPLACE, {
                data: { aggregateId: owner.id },
            });
            const firstJob = deliveries.find((job) => job.data.deliveryId === first.deliveryId)!;
            const secondJob = deliveries.find((job) => job.data.deliveryId === second.deliveryId)!;
            const before = await state(owner.id);
            await app.get(UserAvatarReplaceQueue).consume(firstJob.data);
            expect(await state(owner.id)).toEqual(before);
            expect(await storageFixture.storage.headObject(second.sourceKey)).toMatchObject({ sizeBytes: 4 });
            await expect(storageFixture.storage.headObject(first.sourceKey)).rejects.toMatchObject({
                kind: ExceptionKind.RESOURCE_NOT_FOUND,
            });
            await app.get(UserAvatarReplaceQueue).consume(secondJob.data);
            expect((await state(owner.id)).avatarKey).toBe(second.destinationKey);
            expect((await patch(second.uploadToken)).statusCode).toBe(409);
            expect((await patch(first.uploadToken)).statusCode).toBe(400);
            expect(await evidence(owner.id, UserAuditAction.USER_UPDATED)).toHaveLength(2);
        });

        it('replaces an initial pending avatar and keeps a stale initial delivery from reattaching it', async () => {
            const owner = await account(false);
            const initial = await state(owner.id);
            const initialJob = (
                await boss.findJobs<Job>(UserJobQueue.AVATAR_FINALIZE, {
                    data: { aggregateId: owner.id },
                })
            )[0]!.data;
            expect(initialJob.deliveryId).toBe(owner.id);
            const prepared = await profileUpload(owner);
            const response = await app.inject({
                method: 'PATCH',
                url: '/api/v1/user/me',
                headers: owner.headers,
                payload: { avatar, uploadToken: prepared.uploadToken },
            });
            expect(response.statusCode).toBe(200);
            const delivery = (
                await boss.findJobs<Job>(UserJobQueue.AVATAR_REPLACE, {
                    data: { aggregateId: owner.id },
                })
            )[0]!.data;
            expect(delivery.payload).toEqual({ previousAvatarId: owner.id });
            await app.get(UserAvatarFinalizeQueue).consume(initialJob);
            expect((await state(owner.id)).avatarKey).toBe(prepared.sourceKey);
            await app.get(UserAvatarReplaceQueue).consume(delivery);
            expect((await state(owner.id)).avatarKey).toBe(prepared.destinationKey);
            await expect(storageFixture.storage.headObject(initial.avatarKey)).rejects.toMatchObject({
                kind: ExceptionKind.RESOURCE_NOT_FOUND,
            });
            await app.get(UserAvatarFinalizeQueue).consume(initialJob);
            expect((await state(owner.id)).avatarKey).toBe(prepared.destinationKey);
        });

        it('evicts the profile after both transitions and persists retryable cache jobs', async () => {
            const owner = await account();
            const cache = app.get<ICachePort>(TOKEN_CACHE_PORT);
            const key = CacheKeys.userById(owner.id);
            const before = await state(owner.id);
            const beforeJobs = await jobs(owner.id, UserJobQueue.CACHE_INVALIDATE);
            await cache.set(key, { avatarKey: before.avatarKey }, 60);
            const prepared = await profileUpload(owner);
            const patched = await app.inject({
                method: 'PATCH',
                url: '/api/v1/user/me',
                headers: owner.headers,
                payload: { avatar, uploadToken: prepared.uploadToken },
            });
            expect(patched.statusCode).toBe(200);
            expect(await cache.get(key)).toBeNull();
            expect(await jobs(owner.id, UserJobQueue.CACHE_INVALIDATE)).toHaveLength(beforeJobs.length + 1);
            await cache.set(key, { avatarKey: prepared.sourceKey }, 60);
            const delivery = (
                await boss.findJobs<Job>(UserJobQueue.AVATAR_REPLACE, {
                    data: { aggregateId: owner.id },
                })
            )[0]!.data;
            await app.get(UserAvatarReplaceQueue).consume(delivery);
            expect(await cache.get(key)).toBeNull();
            const cacheJobs = await jobs(owner.id, UserJobQueue.CACHE_INVALIDATE);
            expect(cacheJobs).toHaveLength(beforeJobs.length + 2);
            await cache.set(key, { avatarKey: before.avatarKey }, 60);
            await app.get(UserCacheQueue).consume(cacheJobs.at(-1)!.data);
            expect(await cache.get(key)).toBeNull();
            const fresh = await app.inject({ method: 'GET', url: '/api/v1/user/me', headers: owner.headers });
            expect(fresh.statusCode).toBe(200);
            expect(fresh.json<unknown>()).toMatchObject({ data: { avatarKey: prepared.destinationKey } });
        });

        it('keeps unchanged names free of writes, delivery jobs, and mutation audit', async () => {
            const owner = await account();
            const before = await state(owner.id);
            const cacheJobs = await jobs(owner.id, UserJobQueue.CACHE_INVALIDATE);
            const response = await app.inject({
                method: 'PATCH',
                url: '/api/v1/user/me',
                headers: owner.headers,
                payload: { name: before.name },
            });
            expect(response.statusCode).toBe(200);
            expect(await state(owner.id)).toEqual(before);
            expect(await jobs(owner.id, UserJobQueue.CACHE_INVALIDATE)).toHaveLength(cacheJobs.length);
            expect(await jobs(owner.id, UserJobQueue.AVATAR_REPLACE)).toEqual([]);
            expect(await evidence(owner.id, UserAuditAction.USER_UPDATED)).toEqual([]);
        });

        it('validates upload initiation without changing the account or enqueueing replacement work', async () => {
            const owner = await account();
            const before = await state(owner.id);
            for (const payload of [
                {},
                { name: 'Changed User' },
                { avatar: null },
                { avatar, name: null },
                { avatar: { ...avatar, sizeBytes: 0 } },
                { avatar: { ...avatar, contentType: 'image/svg+xml' } },
                { avatar: { ...avatar, extra: true } },
                { avatar, extra: true },
            ]) {
                const response = await app.inject({
                    method: 'POST',
                    url: '/api/v1/user/me/avatar/initiate',
                    headers: owner.headers,
                    payload,
                });
                expect(response.statusCode).toBe(400);
            }
            expect(await state(owner.id)).toEqual(before);
            expect(await jobs(owner.id, UserJobQueue.AVATAR_REPLACE)).toEqual([]);
        });
    });
});
