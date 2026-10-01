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
import { admin } from 'src/module/admin/infrastructure/admin.schema';
import { MoveUserAvatarCommand } from 'src/module/user/application/command/move-user-avatar/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { UserActivationQueue } from 'src/module/user/application/queue/user-activation.queue';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';
import { buildUserPendingAvatarKey, buildUserPermanentAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { UserUploadPurpose } from 'src/module/user/domain/user-upload-purpose.enum';
import { user } from 'src/module/user/infrastructure/user.schema';
import { DomainFailureAuditAction } from 'src/shared/domain/audit';
import { PrincipalType } from 'src/shared/domain/principal';
import { DependencyUnavailableException } from 'src/shared/exception';
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
        const response = await app.inject({ method: 'POST', url: '/api/v1/user/initiate', payload: form });
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
        const response = await app.inject({ method: 'POST', url: '/api/v1/user', payload });
        expect(response.statusCode).toBe(204);
        expect(response.body).toBe('');
        const [row] = await database.select().from(user).where(eq(user.email, payload.email));
        expect(row?.activationId).toBeTruthy();
        return row!;
    }

    async function proof(row: typeof user.$inferSelect) {
        return tokenPort.generateUserActivationToken({
            sub: row.id,
            jti: row.activationId!,
            exp: Math.floor(row.activationExpiresAt!.getTime() / 1000),
            activationRevocationVersion: row.activationRevocationVersion!,
        });
    }

    async function jobs(id: string) {
        return boss.findJobs<Job>(UserJobQueue.ACTIVATION, { data: { aggregateId: id } });
    }

    async function actions(id: string) {
        return database.select().from(audit).where(eq(audit.targetId, id));
    }

    it('validates public registration, resend, and activation bodies before mutation', async () => {
        const email = `${uuidv7()}@example.test`;
        const invalid = [
            { url: '/api/v1/user', payload: { email, name: 'Activation Test' } },
            { url: '/api/v1/user', payload: { email, name: 'Activation Test', password, extra: true } },
            ...[
                { sizeBytes: 0, contentType: 'image/png' },
                { sizeBytes: 5 * 1024 * 1024 + 1, contentType: 'image/png' },
                { sizeBytes: 4, contentType: 'image/svg+xml' },
                { sizeBytes: 4, contentType: 'image/png', extra: true },
            ].map((avatar) => ({
                url: '/api/v1/user/initiate',
                payload: { email, name: 'Activation Test', password, avatar },
            })),
            { url: '/api/v1/user/activation/resend', payload: { email: 'invalid' } },
            { url: '/api/v1/user/activate', payload: { token: 'not-a-jwt', password } },
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
            url: '/api/v1/user',
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
            url: '/api/v1/user',
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
        expect((await actions(row.id)).filter((entry) => entry.action === AuditAction.USER_REGISTERED)).toHaveLength(1);

        const duplicate = await app.inject({
            method: 'POST',
            url: '/api/v1/user/initiate',
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
            app.inject({ method: 'POST', url: '/api/v1/user', payload }),
            app.inject({ method: 'POST', url: '/api/v1/user', payload: otherPayload }),
        ]);
        expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 409]);
        const rows = await database.select().from(user).where(eq(user.email, email));
        expect(rows).toHaveLength(1);
        ids.push(rows[0]!.id);
        expect(await jobs(rows[0]!.id)).toHaveLength(1);
        expect(
            (await actions(rows[0]!.id)).filter((entry) => entry.action === AuditAction.USER_REGISTERED),
        ).toHaveLength(1);
    });

    it('rejects missing uploads and changed form bindings without creating accounts', async () => {
        const payload = await prepareRegistration(undefined, false);
        for (const candidate of [payload, { ...payload, name: 'Changed' }]) {
            const response = await app.inject({ method: 'POST', url: '/api/v1/user', payload: candidate });
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
            const response = await app.inject({ method: 'POST', url: '/api/v1/user', payload });
            expect(response.statusCode).toBe(400);
            expect(await database.select().from(user).where(eq(user.email, payload.email))).toEqual([]);
        }
    });

    it('preserves a committed account and its jobs on upload token replay', async () => {
        const payload = await prepareRegistration();
        const responses = await Promise.all([
            app.inject({ method: 'POST', url: '/api/v1/user', payload }),
            app.inject({ method: 'POST', url: '/api/v1/user', payload }),
        ]);
        expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 409]);
        const [row] = await database.select().from(user).where(eq(user.email, payload.email));
        const replay = await app.inject({ method: 'POST', url: '/api/v1/user', payload });
        expect(replay.statusCode).toBe(409);
        expect((await database.select().from(user).where(eq(user.id, row!.id)))[0]).toEqual(row);
        expect(await jobs(row!.id)).toHaveLength(1);
        expect(await boss.findJobs<Job>(UserJobQueue.AVATAR_MOVE, { data: { aggregateId: row!.id } })).toHaveLength(1);
    });

    it('recovers a copied avatar after transaction rollback and repeats cleanup without recopying', async () => {
        const row = await register();
        const [job] = await boss.findJobs<Job>(UserJobQueue.AVATAR_MOVE, { data: { aggregateId: row.id } });
        const destination = buildUserPermanentAvatarKey(row.id, job!.data.deliveryId);
        const source = buildUserPendingAvatarKey(row.id);
        objectKeys.add(destination);
        const pipeline = app.get(CommandPipeline);
        const command = new MoveUserAvatarCommand(row.id, job!.data.deliveryId);
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
            (await actions(row.id)).filter((entry) => entry.action === AuditAction.USER_AVATAR_FINALIZED),
        ).toHaveLength(1);
        await expect(storageFixture.storage.headObject(source)).rejects.toMatchObject({ kind: 'RESOURCE_NOT_FOUND' });
    });

    it('retries cleanup after the permanent key commits without duplicating its audit', async () => {
        const row = await register();
        const [job] = await boss.findJobs<Job>(UserJobQueue.AVATAR_MOVE, { data: { aggregateId: row.id } });
        const destination = buildUserPermanentAvatarKey(row.id, job!.data.deliveryId);
        objectKeys.add(destination);
        const command = new MoveUserAvatarCommand(row.id, job!.data.deliveryId);
        const pipeline = app.get(CommandPipeline);
        vi.spyOn(storageFixture.storage, 'deleteObject').mockRejectedValueOnce(new DependencyUnavailableException());
        await expect(pipeline.execute(command)).rejects.toMatchObject({ kind: 'DEPENDENCY_UNAVAILABLE' });
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.avatarKey).toBe(destination);
        const copy = vi.spyOn(storageFixture.storage, 'copyObject');
        await pipeline.execute(command);
        expect(copy).not.toHaveBeenCalled();
        expect(
            (await actions(row.id)).filter((entry) => entry.action === AuditAction.USER_AVATAR_FINALIZED),
        ).toHaveLength(1);
        await expect(storageFixture.storage.headObject(buildUserPendingAvatarKey(row.id))).rejects.toMatchObject({
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
            url: '/api/v1/user/activate',
            payload: { token, password: 'WrongPass-12345!' },
        });
        expect(wrongPassword.statusCode).toBe(400);
        expect(
            (await actions(row.id)).filter((entry) => entry.action === DomainFailureAuditAction.USER_ACTIVATION_FAILED),
        ).toHaveLength(1);
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBe(row.activationId);

        const activated = await app.inject({
            method: 'POST',
            url: '/api/v1/user/activate',
            payload: { token, password },
        });
        expect(activated.statusCode).toBe(200);
        expect(Object.keys(data(activated)).sort()).toEqual(['accessToken', 'refreshToken', 'session']);
        expect(data(activated)['session']).toBe('created');
        expect(typeof data(activated)['accessToken']).toBe('string');
        expect(typeof data(activated)['refreshToken']).toBe('string');
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBeNull();
        expect(
            (await app.inject({ method: 'POST', url: '/api/v1/user/activate', payload: { token, password } }))
                .statusCode,
        ).toBe(409);
        expect(data(await login(password))['session']).toBe('created');
        expect((await actions(row.id)).filter((entry) => entry.action === AuditAction.USER_ACTIVATED)).toHaveLength(1);
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
            const token = await tokenPort.generateUserActivationToken(claims);
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/user/activate',
                payload: { token, password },
            });
            expect(response.statusCode).toBe(400);
        }
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBe(row.activationId);
        expect((await actions(row.id)).filter((entry) => entry.action === AuditAction.USER_ACTIVATED)).toHaveLength(0);
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
            (await app.inject({ method: 'POST', url: '/api/v1/user/activate', payload: { token: oldToken, password } }))
                .statusCode,
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
            (await actions(row.id)).filter((entry) => entry.action === AuditAction.USER_ACTIVATION_REQUESTED),
        ).toHaveLength(2);
        expect(
            (
                await app.inject({
                    method: 'POST',
                    url: '/api/v1/user/activate',
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
            (await actions(row.id)).filter((entry) => entry.action === AuditAction.USER_ACTIVATION_REQUESTED),
        ).toHaveLength(1);
    });

    it('returns indistinguishable 204 for unknown and active accounts', async () => {
        const row = await register();
        const request = (email: string) =>
            app.inject({ method: 'POST', url: '/api/v1/user/activation/resend', payload: { email } });
        expect((await request(`${uuidv7()}@example.test`)).statusCode).toBe(204);
        await app.inject({
            method: 'POST',
            url: '/api/v1/user/activate',
            payload: { token: await proof(row), password },
        });
        expect((await request(row.email)).statusCode).toBe(204);
        expect(await jobs(row.id)).toHaveLength(1);
    });

    it('allows only one of two concurrent activations to consume the same proof', async () => {
        const row = await register();
        const token = await proof(row);
        const responses = await Promise.all([
            app.inject({ method: 'POST', url: '/api/v1/user/activate', payload: { token, password } }),
            app.inject({ method: 'POST', url: '/api/v1/user/activate', payload: { token, password } }),
        ]);
        expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
        expect((await actions(row.id)).filter((entry) => entry.action === AuditAction.USER_ACTIVATED)).toHaveLength(1);
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
            app.inject({ method: 'POST', url: '/api/v1/user/activate', payload: { token, password } }),
            app.inject({ method: 'POST', url: '/api/v1/user/activation/resend', payload: { email: row.email } }),
        ]);
        expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(1);
        expect(responses.some((response) => response.statusCode === 200 || response.statusCode === 204)).toBe(true);
        const committed = (await actions(row.id)).filter(
            (entry) =>
                entry.action === AuditAction.USER_ACTIVATED || entry.action === AuditAction.USER_ACTIVATION_REQUESTED,
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
        const request = app.inject({ method: 'POST', url: '/api/v1/user/activate', payload: { token, password } });
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
        expect((await actions(row.id)).filter((entry) => entry.action === AuditAction.USER_ACTIVATED)).toHaveLength(0);
    });

    it('rolls back activation when its success audit cannot be persisted', async () => {
        const row = await register();
        const token = await proof(row);
        vi.spyOn(auditPort, 'record').mockRejectedValueOnce(new DependencyUnavailableException());
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/user/activate',
            payload: { token, password },
        });
        expect(response.statusCode).toBe(503);
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBe(row.activationId);
        expect((await actions(row.id)).filter((entry) => entry.action === AuditAction.USER_ACTIVATED)).toHaveLength(0);
    });

    it('keeps activation committed when token generation fails after commit', async () => {
        const row = await register();
        const token = await proof(row);
        vi.spyOn(tokenPort, 'generateTokens').mockRejectedValueOnce(new Error('unexpected signing failure'));
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/user/activate',
            payload: { token, password },
        });
        expect(response.statusCode).toBe(500);
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBeNull();
        expect(
            (await app.inject({ method: 'POST', url: '/api/v1/user/activate', payload: { token, password } }))
                .statusCode,
        ).toBe(409);
    });

    it('returns login_required after a recognized session outage without undoing activation', async () => {
        const row = await register();
        vi.spyOn(sessionPort, 'openSession').mockRejectedValueOnce(new DependencyUnavailableException());
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/user/activate',
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
            url: '/api/v1/user/activate',
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
            url: '/api/v1/user/activate',
            payload: { token: await proof(row), password },
        });
        expect(response.statusCode).toBe(200);
        expect(data(response)).toEqual({ session: 'login_required' });
        expect((await database.select().from(user).where(eq(user.id, row.id)))[0]!.activationId).toBeNull();
    });
});
