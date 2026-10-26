/**
 * @file email-change.e2e-spec.ts
 * @description Exercises both email-change contexts through production HTTP wiring and real PostgreSQL/Redis.
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { LightMyRequestResponse } from 'fastify';
import type Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { PgBoss, type JobWithMetadata } from 'pg-boss';
import { symbols, type DestinationStream } from 'pino';
import { TOKEN_CACHE_PORT, type ICachePort } from 'src/core/cache';
import { TOKEN_DATABASE_CLIENT, TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_EMAILER_PORT, type IEmailerPort } from 'src/core/email';
import {
    JOB_QUEUE_DEAD_LETTER,
    TOKEN_JOB_QUEUE_WRITER_PORT,
    type IJobQueueWriterPort,
    type Job,
} from 'src/core/job-queue';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { audit, AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';
import { TOKEN_TOKEN_PORT, type EmailConfirmationTokenPayload, type ITokenPort } from 'src/core/security/token';
import {
    TOKEN_ADMIN_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT,
    type IAdminEmailChangeNotificationWriterPort,
} from 'src/module/admin/application/command/port/admin-email-change-notification-writer.port';
import { TOKEN_ADMIN_WRITER_PORT } from 'src/module/admin/application/command/port/admin-writer.port';
import { AdminEmailChangeNotificationQueue } from 'src/module/admin/application/queue/admin-email-change-notification.queue';
import { AdminEmailConfirmationQueue } from 'src/module/admin/application/queue/admin-email-confirmation.queue';
import { AdminSessionQueue } from 'src/module/admin/application/queue/admin-session.queue';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';
import { admin, emailChangeNotification as adminNotification } from 'src/module/admin/infrastructure/admin.schema';
import { TOKEN_USER_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT } from 'src/module/user/application/command/port/user-email-change-notification-writer.port';
import { TOKEN_USER_WRITER_PORT } from 'src/module/user/application/command/port/user-writer.port';
import { UserCacheQueue } from 'src/module/user/application/queue/user-cache.queue';
import { UserEmailChangeNotificationQueue } from 'src/module/user/application/queue/user-email-change-notification.queue';
import { UserEmailConfirmationQueue } from 'src/module/user/application/queue/user-email-confirmation.queue';
import { UserSessionQueue } from 'src/module/user/application/queue/user-session.queue';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';
import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';
import { user, emailChangeNotification as userNotification } from 'src/module/user/infrastructure/user.schema';
import { DomainFailureAuditAction } from 'src/shared/domain/audit';
import { PrincipalAuditAction, PrincipalType } from 'src/shared/domain/principal';
import { AccessDeniedException, DependencyUnavailableException } from 'src/shared/exception';
import { createTestApp } from 'test/shared/test-app.factory';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Persisted fixture identity and its real registered session.
 */
type Account = {
    /**
     * Account identifier shared by DB and JWT subject.
     */
    readonly id: string;
    /**
     * Original sign-in address.
     */
    readonly email: string;
    /**
     * Access credential registered in Redis.
     */
    readonly accessToken: string;
    /**
     * Refresh credential registered in Redis.
     */
    readonly refreshToken: string;
};

/**
 * Only the writer read contract is needed to synchronize concurrent requests.
 */
type AccountReader = {
    /**
     * Loads current primary state using the real writer.
     *
     * @param id Target fixture account
     * @returns Its aggregate, or null when missing
     */
    load(id: string): Promise<Admin | User | null>;
};

/**
 * Identical external guarantees apply to both owning contexts.
 */
const CASES = [
    {
        kind: PrincipalType.ADMIN,
        route: 'admin',
        table: admin,
        notification: adminNotification,
        queues: AdminJobQueue,
        writerToken: TOKEN_ADMIN_WRITER_PORT,
        noticeWriterToken: TOKEN_ADMIN_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT,
    },
    {
        kind: PrincipalType.USER,
        route: 'user',
        table: user,
        notification: userNotification,
        queues: UserJobQueue,
        writerToken: TOKEN_USER_WRITER_PORT,
        noticeWriterToken: TOKEN_USER_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT,
    },
] as const;

describe.each(CASES)('$route email change', (context) => {
    let app: NestFastifyApplication;
    let database: NodePgDatabase;
    let boss: PgBoss;
    let tokenPort: ITokenPort;
    let sessionPort: ISessionPort;
    let hashingPort: IHashingPort;
    let hash: string;
    let account: Account;
    const ids: string[] = [];
    const sendEmail = vi.fn<IEmailerPort['sendEmail']>();
    const report = vi.fn<IErrorReporterPort['report']>();
    const password = 'Email-phase7!Test123';
    const base = `/api/v1/${context.route}/me`;

    beforeAll(async () => {
        app = await createTestApp({
            overrides: [
                { provide: TOKEN_EMAILER_PORT, useValue: { sendEmail } },
                { provide: TOKEN_ERROR_REPORTER_PORT, useValue: { report } },
            ],
        });
        database = app.get(TOKEN_DATABASE_CLIENT);
        boss = app.get(TOKEN_JOB_QUEUE_CLIENT);
        tokenPort = app.get(TOKEN_TOKEN_PORT);
        sessionPort = app.get(TOKEN_SESSION_PORT);
        hashingPort = app.get(TOKEN_HASHING_PORT);
        hash = await hashingPort.hash(password);
        // Control delivery timing without replacing queue persistence or production consumers.
        for (const queue of await boss.getQueues()) {
            await boss.offWork(queue.name);
        }
    }, 30_000);

    beforeEach(async () => {
        sendEmail.mockResolvedValue(undefined);
        account = await createAccount();
    });

    afterEach(async () => {
        if (!account || !boss) {
            return;
        }
        for (const queue of await boss.getQueues()) {
            const pending = await boss.findJobs<Job>(queue.name, { data: { aggregateId: account.id } });
            if (pending.length) {
                await boss.deleteJob(
                    queue.name,
                    pending.map((job) => job.id),
                );
            }
        }
    });

    afterAll(async () => {
        if (!app) {
            return;
        }
        if (boss && database) {
            const queues = await boss.getQueues();
            for (const queue of queues) {
                await boss.offWork(queue.name);
            }
            for (const id of ids) {
                for (const queue of queues) {
                    const jobs = await boss.findJobs<Job>(queue.name, { data: { aggregateId: id } });
                    if (jobs.length) {
                        await boss.deleteJob(
                            queue.name,
                            jobs.map((job) => job.id),
                        );
                    }
                }
                await database.delete(audit).where(or(eq(audit.actorId, id), eq(audit.targetId, id)));
                await database.delete(context.notification).where(eq(context.notification.aggregateId, id));
                await database.delete(context.table).where(eq(context.table.id, id));
                await app.get<ICachePort>(TOKEN_CACHE_PORT).delete(CacheKeys.userById(id));
                const redis = app.get<Redis>(TOKEN_SESSION_CONNECTION);
                let cursor = '0';
                do {
                    const [next, keys] = await redis.scan(
                        cursor,
                        'MATCH',
                        `auth:{${context.kind}:${id}}:*`,
                        'COUNT',
                        100,
                    );
                    cursor = next;
                    if (keys.length) {
                        await redis.del(...keys);
                    }
                } while (cursor !== '0');
            }
        }
        await app.close();
    }, 30_000);

    /**
     * Seeds an account while retaining real Argon2, JWT, and Redis behavior.
     *
     * @param email Optional already-chosen address for uniqueness races
     * @returns The account and registered credentials
     */
    async function createAccount(email = `${uuidv7()}@example.test`): Promise<Account> {
        const id = uuidv7();
        ids.push(id);
        await database.insert(context.table).values({
            id,
            email,
            name: 'Phase Seven',
            password: hash,
            avatarKey: `avatar/${context.kind}/${id}/${uuidv7()}`,
        });
        const pair = await tokenPort.generateTokens({ id, type: context.kind, permissions: [] }, 0);
        expect(await sessionPort.openSession(id, pair.session)).toBe(true);
        return { id, email, accessToken: pair.accessToken, refreshToken: pair.refreshToken };
    }

    /**
     * Reads committed state directly so cache cannot hide a failed write.
     *
     * @returns The current fixture row
     */
    async function state(): Promise<typeof context.table.$inferSelect> {
        const rows = await database.select().from(context.table).where(eq(context.table.id, account.id));
        return rows[0]!;
    }

    /**
     * Sends a request through the production guards, validation, pipeline and filter.
     *
     * @param method HTTP operation
     * @param path Relative self endpoint
     * @param payload JSON request body
     * @param bearer Optional authenticated credential
     * @returns Fastify's fully serialized HTTP response
     */
    async function http(
        method: 'POST' | 'PATCH' | 'GET',
        path: string,
        payload?: Record<string, unknown>,
        bearer: string | null = account.accessToken,
    ): Promise<LightMyRequestResponse> {
        return app.inject({
            method,
            url: `${base}${path}`,
            ...(payload ? { payload } : {}),
            ...(bearer ? { headers: { authorization: `Bearer ${bearer}` } } : {}),
        });
    }

    /**
     * Creates a request through HTTP and derives proof from committed metadata.
     *
     * @param email Requested target
     * @returns Signed proof and fixed claims
     */
    async function pending(email = `${uuidv7()}@example.test`): Promise<{
        /**
         * Signed proof for this request.
         */
        readonly token: string;
        /**
         * Immutable claims used by delivery retries.
         */
        readonly claims: Omit<EmailConfirmationTokenPayload, 'type'>;
        /**
         * Requested target address.
         */
        readonly email: string;
    }> {
        expect((await http('POST', '/email/initiate', { newEmail: email, currentPassword: password })).statusCode).toBe(
            204,
        );
        const row = await state();
        const claims: Omit<EmailConfirmationTokenPayload, 'type'> = {
            sub: account.id,
            principalType: context.kind,
            jti: row.pendingEmailRequestId!,
            exp: row.pendingEmailExpiresAt!.getTime() / 1000,
            emailRevocationVersion: row.pendingEmailRevocationVersion!,
        };
        return { token: await tokenPort.generateEmailConfirmationToken(claims), claims, email };
    }

    /**
     * Locates only this fixture's durable deliveries.
     *
     * @param queueName Owning queue
     * @returns Committed jobs for the account
     */
    async function jobs(queueName: string): Promise<JobWithMetadata<Job>[]> {
        return boss.findJobs<Job>(queueName, { data: { aggregateId: account.id } });
    }

    /**
     * Reads committed notices independently from the live profile.
     *
     * @returns Immutable notification rows
     */
    async function notices(): Promise<(typeof context.notification.$inferSelect)[]> {
        return database.select().from(context.notification).where(eq(context.notification.aggregateId, account.id));
    }

    /**
     * Reads durable evidence for the current authenticated actor.
     *
     * @param action Expected event category
     * @returns Matching audit rows
     */
    async function evidence(action: string): Promise<(typeof audit.$inferSelect)[]> {
        return database
            .select()
            .from(audit)
            .where(and(eq(audit.actorId, account.id), eq(audit.action, action)));
    }

    /**
     * Calls the real consumer with the persisted job payload.
     *
     * @param job Committed confirmation job
     */
    async function deliver(job: Job) {
        if (context.kind === PrincipalType.ADMIN) {
            await app.get(AdminEmailConfirmationQueue).consume(job);
        } else {
            await app.get(UserEmailConfirmationQueue).consume(job);
        }
    }

    /**
     * Synchronizes two real requests at a chosen boundary without timing sleeps.
     *
     * @returns A promise and its release callback
     */
    function deferred(): {
        /**
         * Resolves when both requests may proceed.
         */
        readonly promise: Promise<void>;
        /**
         * Releases the waiting request.
         */
        readonly resolve: () => void;
    } {
        let resolve!: () => void;
        const promise = new Promise<void>((release) => {
            resolve = release;
        });
        return { promise, resolve };
    }

    /**
     * Delivers a persisted old-address notice through its production consumer.
     *
     * @param job Durable notification payload
     */
    async function notify(job: Job) {
        if (context.kind === PrincipalType.ADMIN) {
            await app.get(AdminEmailChangeNotificationQueue).consume(job);
        } else {
            await app.get(UserEmailChangeNotificationQueue).consume(job);
        }
    }

    it('rejects profile email and missing name, while preserving name changes and no-op writes', async () => {
        const before = await state();
        for (const payload of [{ name: 'Changed', email: 'bypass@example.test' }, {}]) {
            const response = await http('PATCH', '', payload);
            expect(response.statusCode).toBe(400);
            expect(response.json()).toMatchObject({
                error: { statusCode: 400, message: expect.any(Array) as unknown },
            });
        }
        expect(await state()).toEqual(before);
        expect((await http('PATCH', '', { name: before.name })).statusCode).toBe(200);
        expect(await state()).toEqual(before);
        expect((await http('PATCH', '', { name: 'Changed' })).statusCode).toBe(200);
        expect(await state()).toMatchObject({
            name: 'Changed',
            email: before.email,
            sessionVersion: 0,
            revocationVersion: 0,
        });
    });

    it('requires authentication and rejects unknown fields in both email endpoints', async () => {
        const before = await state();
        expect(
            (await http('POST', '/email/initiate', { newEmail: 'new@example.test', currentPassword: password }, null))
                .statusCode,
        ).toBe(401);
        const proof = await pending();
        expect((await http('POST', '/email/confirm', { token: proof.token }, null)).statusCode).toBe(401);
        expect((await http('POST', '/email/confirm', {})).statusCode).toBe(400);
        expect((await http('POST', '/email/confirm', { token: proof.token, id: uuidv7() })).statusCode).toBe(400);
        expect(
            (
                await http('POST', '/email/initiate', {
                    newEmail: 'new@example.test',
                    currentPassword: password,
                    id: uuidv7(),
                })
            ).statusCode,
        ).toBe(400);
        expect((await state()).email).toBe(before.email);
        expect(await notices()).toEqual([]);
    });

    it('rejects the other authenticated principal kind before reaching the command', async () => {
        const kind = context.kind === PrincipalType.ADMIN ? PrincipalType.USER : PrincipalType.ADMIN;
        const pair = await tokenPort.generateTokens({ id: account.id, type: kind, permissions: [] }, 0);
        await sessionPort.openSession(account.id, pair.session);
        const proof = await pending();
        for (const [path, body] of [
            ['/email/initiate', { newEmail: proof.email, currentPassword: password }],
            ['/email/confirm', { token: proof.token }],
        ] as const) {
            expect((await http('POST', path, body, pair.accessToken)).statusCode).toBe(403);
        }
        expect(await notices()).toEqual([]);
    });

    it('audits incorrect current-password proof without changing state or queuing delivery', async () => {
        const before = await state();
        const response = await http('POST', '/email/initiate', {
            newEmail: account.email,
            currentPassword: 'Wrong-password123!',
        });
        expect(response.statusCode).toBe(400);
        expect(await state()).toEqual(before);
        expect(await jobs(context.queues.EMAIL_CONFIRMATION)).toEqual([]);
        expect(await evidence(DomainFailureAuditAction.EMAIL_CHANGE_REQUEST_FAILED)).toMatchObject([
            { actorId: account.id, actorType: context.kind, reason: 'CURRENT_PASSWORD_MISMATCH' },
        ]);
    });

    it('starts without changing credentials or sessions and rejects same/taken addresses', async () => {
        expect(
            (await http('POST', '/email/initiate', { newEmail: account.email, currentPassword: password })).statusCode,
        ).toBe(400);
        const other = await createAccount();
        expect(
            (await http('POST', '/email/initiate', { newEmail: other.email, currentPassword: password })).statusCode,
        ).toBe(409);
        const proof = await pending();
        expect(await state()).toMatchObject({
            email: account.email,
            password: hash,
            sessionVersion: 0,
            revocationVersion: 0,
            pendingEmail: proof.email,
        });
        expect(await jobs(context.queues.EMAIL_CONFIRMATION)).toMatchObject([
            { data: { deliveryId: proof.claims.jti, aggregateId: account.id } },
        ]);
        expect(await evidence(PrincipalAuditAction.EMAIL_CHANGE_REQUESTED)).toHaveLength(1);
        expect((await http('GET', '')).statusCode).toBe(200);
    });

    it('repeats the identical emailed JWT and skips a replaced job without refusal audits', async () => {
        await database
            .update(context.table)
            .set({ name: '<img src=x onerror=alert(1)>' })
            .where(eq(context.table.id, account.id));
        const first = await pending();
        const job = (await jobs(context.queues.EMAIL_CONFIRMATION))[0]!;
        await deliver(job.data);
        await deliver(job.data);
        expect(sendEmail).toHaveBeenCalledTimes(2);
        const firstMail = sendEmail.mock.calls[0]![0];
        expect(sendEmail.mock.calls[1]![0]).toEqual(firstMail);
        expect(firstMail.to).toBe(first.email);
        expect(firstMail.body).toContain(first.token);
        expect(firstMail.body).toContain('&lt;img');
        expect(firstMail.body).not.toContain('<img');
        const next = await pending(first.email);
        expect(next.claims.jti).not.toBe(first.claims.jti);
        await deliver(job.data);
        expect(sendEmail).toHaveBeenCalledTimes(2);
        expect(await evidence(DomainFailureAuditAction.EMAIL_CHANGE_CONFIRMATION_FAILED)).toEqual([]);
        const before = await state();
        expect((await http('POST', '/email/confirm', { token: first.token })).statusCode).toBe(400);
        expect(await state()).toEqual(before);
    });

    it.each(['signature', 'type', 'subject', 'principal', 'request', 'expiry', 'revocation', 'expired'] as const)(
        'rejects %s proof mismatches without side effects',
        async (fault) => {
            const proof = await pending();
            const before = await state();
            let token = proof.token;
            if (fault === 'signature') {
                const parts = token.split('.');
                parts[2] = `${parts[2]![0] === 'a' ? 'b' : 'a'}${parts[2]!.slice(1)}`;
                token = parts.join('.');
            } else if (fault === 'type') {
                token = account.accessToken;
            } else {
                const claims = { ...proof.claims };
                if (fault === 'subject') {
                    claims.sub = (await createAccount()).id;
                }
                if (fault === 'principal') {
                    claims.principalType =
                        context.kind === PrincipalType.ADMIN ? PrincipalType.USER : PrincipalType.ADMIN;
                }
                if (fault === 'request') {
                    claims.jti = randomUUID();
                }
                if (fault === 'expiry') {
                    claims.exp += 1;
                }
                if (fault === 'revocation') {
                    claims.emailRevocationVersion += 1;
                }
                if (fault === 'expired') {
                    claims.exp = Math.floor(Date.now() / 1000) - 1;
                }
                token = await tokenPort.generateEmailConfirmationToken(claims);
            }
            const response = await http('POST', '/email/confirm', { token });
            const expectedStatus = fault === 'subject' || fault === 'principal' ? 403 : 400;
            expect(response.statusCode).toBe(expectedStatus);
            expect(response.json()).toMatchObject({
                error: { statusCode: expectedStatus, message: expect.any(Array) as unknown },
            });
            expect(await state()).toEqual(before);
            expect(await notices()).toEqual([]);
            expect(await jobs(context.queues.EMAIL_CHANGE_NOTIFICATION)).toEqual([]);
            expect(await evidence(PrincipalAuditAction.EMAIL_CHANGED)).toEqual([]);
            const failures = await evidence(DomainFailureAuditAction.EMAIL_CHANGE_CONFIRMATION_FAILED);
            if (expectedStatus === 403) {
                expect(failures).toHaveLength(1);
                expect(failures[0]!.targetId).toBe((await tokenPort.verifyEmailConfirmationToken(token)).sub);
            } else {
                expect(failures).toEqual([]);
            }
            if (expectedStatus === 403) {
                expect(await evidence(AuditAction.ACCESS_DENIED)).toEqual([]);
            }
        },
    );

    it('returns 404 without auditing a verified proof whose account was removed', async () => {
        const proof = await pending();
        await database.delete(context.table).where(eq(context.table.id, account.id));

        const response = await http('POST', '/email/confirm', { token: proof.token });
        expect(response.statusCode).toBe(404);
        expect(await evidence(DomainFailureAuditAction.EMAIL_CHANGE_CONFIRMATION_FAILED)).toEqual([]);
        expect(await notices()).toEqual([]);
        expect(await evidence(PrincipalAuditAction.EMAIL_CHANGED)).toEqual([]);
    });

    it('commits the change, rejects all old sessions and accepts only registered replacement tokens', async () => {
        const secondSession = await tokenPort.generateTokens(
            { id: account.id, type: context.kind, permissions: [] },
            0,
        );
        await sessionPort.openSession(account.id, secondSession.session);
        const proof = await pending();
        const response = await http('POST', '/email/confirm', { token: proof.token });
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toContain('no-store');
        const data = response.json<{ data: { session: string; accessToken: string; refreshToken: string } }>().data;
        expect(data).toEqual({
            session: 'created',
            accessToken: expect.any(String) as unknown,
            refreshToken: expect.any(String) as unknown,
        });
        expect(await state()).toMatchObject({
            email: proof.email,
            password: hash,
            pendingEmail: null,
            pendingEmailRequestId: null,
            pendingEmailExpiresAt: null,
            pendingEmailRevocationVersion: null,
            sessionVersion: 1,
            revocationVersion: 1,
        });
        for (const access of [account.accessToken, secondSession.accessToken]) {
            expect((await http('GET', '', undefined, access)).statusCode).toBe(401);
        }
        expect((await http('GET', '', undefined, data.accessToken)).statusCode).toBe(200);
        expect(
            (
                await app.inject({
                    method: 'POST',
                    url: '/api/v1/auth/refresh',
                    payload: { refreshToken: account.refreshToken },
                })
            ).statusCode,
        ).toBe(401);
        expect((await http('POST', '/email/confirm', { token: proof.token }, data.accessToken)).statusCode).toBe(400);
        expect(await notices()).toMatchObject([
            { previousEmail: account.email, aggregateId: account.id, createdAt: expect.any(Date) as unknown },
        ]);
        expect(await evidence(PrincipalAuditAction.EMAIL_CHANGED)).toHaveLength(1);
        const mirrorJob = (await jobs(context.queues.SESSION_RECONCILE))[0]!;
        if (context.kind === PrincipalType.ADMIN) {
            await app.get(AdminSessionQueue).consume(mirrorJob.data);
        } else {
            await app.get(UserSessionQueue).consume(mirrorJob.data);
        }
        expect((await http('GET', '', undefined, data.accessToken)).statusCode).toBe(200);
        expect(
            (
                await app.inject({
                    method: 'POST',
                    url: '/api/v1/auth/refresh',
                    payload: { refreshToken: data.refreshToken },
                })
            ).statusCode,
        ).toBe(200);
    });

    it.each(['unavailable', 'newer-version'] as const)(
        'preserves committed state and returns login_required on %s registration',
        async (cause) => {
            const proof = await pending();
            if (cause === 'unavailable') {
                vi.spyOn(sessionPort, 'openSession').mockRejectedValueOnce(new DependencyUnavailableException());
            } else {
                const open = sessionPort.openSession.bind(sessionPort);
                vi.spyOn(sessionPort, 'openSession').mockImplementationOnce(async (id, registration) => {
                    await sessionPort.setVersion(id, registration.principalType, registration.sessionVersion + 1);
                    return open(id, registration);
                });
            }
            const response = await http('POST', '/email/confirm', { token: proof.token });
            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ data: { session: 'login_required' } });
            expect((await state()).email).toBe(proof.email);
            expect(await notices()).toHaveLength(1);
            expect(await evidence(PrincipalAuditAction.EMAIL_CHANGED)).toHaveLength(1);
            expect(await jobs(context.queues.SESSION_RECONCILE)).toHaveLength(1);
        },
    );

    it.each(['audit', 'job', 'notification'] as const)(
        'rolls back every write on %s persistence failure',
        async (fault) => {
            const proof = await pending();
            const before = await state();
            const failure = new Error('Injected persistence failure');
            if (fault === 'audit') {
                vi.spyOn(app.get<IAuditPort>(TOKEN_AUDIT_PORT), 'record').mockRejectedValueOnce(failure);
            }
            if (fault === 'notification') {
                vi.spyOn(
                    app.get<IAdminEmailChangeNotificationWriterPort>(context.noticeWriterToken),
                    'save',
                ).mockRejectedValueOnce(failure);
            }
            if (fault === 'job') {
                const writer = app.get<IJobQueueWriterPort>(TOKEN_JOB_QUEUE_WRITER_PORT);
                const enqueue = writer.enqueue.bind(writer);
                vi.spyOn(writer, 'enqueue').mockImplementationOnce(async (jobs) => {
                    await enqueue(jobs);
                    throw failure;
                });
            }
            const open = vi.spyOn(sessionPort, 'openSession');
            expect((await http('POST', '/email/confirm', { token: proof.token })).statusCode).toBe(500);
            expect(await state()).toEqual(before);
            expect(await notices()).toEqual([]);
            expect(await evidence(PrincipalAuditAction.EMAIL_CHANGED)).toEqual([]);
            expect(await jobs(context.queues.EMAIL_CHANGE_NOTIFICATION)).toEqual([]);
            expect(await jobs(context.queues.SESSION_RECONCILE)).toEqual([]);
            expect(open).not.toHaveBeenCalled();
        },
    );

    it('rolls back when the target address is claimed after the request', async () => {
        const proof = await pending();
        const before = await state();
        await createAccount(proof.email);
        expect((await http('POST', '/email/confirm', { token: proof.token })).statusCode).toBe(409);
        expect(await state()).toEqual(before);
        expect(await notices()).toEqual([]);
        expect(await evidence(PrincipalAuditAction.EMAIL_CHANGED)).toEqual([]);
        expect(await jobs(context.queues.EMAIL_CHANGE_NOTIFICATION)).toEqual([]);
    });

    it('allows only one of two confirmations loaded at the same version to commit', async () => {
        const proof = await pending();
        const writer = app.get<AccountReader>(context.writerToken);
        const load = writer.load.bind(writer);
        const ready = deferred();
        let arrivals = 0;
        vi.spyOn(writer, 'load').mockImplementation(async (id) => {
            const aggregate = await load(id);
            arrivals += 1;
            if (arrivals === 2) {
                ready.resolve();
            }
            await ready.promise;
            return aggregate;
        });
        const responses = await Promise.all([
            http('POST', '/email/confirm', { token: proof.token }),
            http('POST', '/email/confirm', { token: proof.token }),
        ]);
        expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
        expect(await notices()).toHaveLength(1);
        expect(await evidence(PrincipalAuditAction.EMAIL_CHANGED)).toHaveLength(1);
        expect(await jobs(context.queues.EMAIL_CHANGE_NOTIFICATION)).toHaveLength(1);
        expect((await state()).sessionVersion).toBe(1);
    });

    it('does not leak passwords, addresses or tokens into durable audit facts', async () => {
        const proof = await pending();
        await http('POST', '/email/initiate', { newEmail: proof.email, currentPassword: 'Wrong-password123!' });
        await http('POST', '/email/confirm', { token: proof.token });
        const rows = await database.select().from(audit).where(eq(audit.actorId, account.id));
        expect(rows.length).toBeGreaterThanOrEqual(3);
        const serialized = JSON.stringify(rows);
        for (const sensitive of [
            password,
            hash,
            account.email,
            proof.email,
            account.accessToken,
            account.refreshToken,
            proof.token,
        ]) {
            expect(serialized).not.toContain(sensitive);
        }
    });
    it.each(['password', 'ban', 'revocation'] as const)(
        'rejects request writes decided before a concurrent %s change',
        async (change) => {
            const originalVerify = hashingPort.verify.bind(hashingPort);
            vi.spyOn(hashingPort, 'verify').mockImplementationOnce(async (stored, supplied) => {
                const result = await originalVerify(stored, supplied);
                await database
                    .update(context.table)
                    .set({
                        version: 1,
                        sessionVersion: 1,
                        revocationVersion: 1,
                        ...(change === 'password' ? { password: 'concurrently changed hash' } : {}),
                        ...(change === 'ban' ? { isBanned: true } : {}),
                    })
                    .where(eq(context.table.id, account.id));
                return result;
            });
            expect(
                (await http('POST', '/email/initiate', { newEmail: 'race@example.test', currentPassword: password }))
                    .statusCode,
            ).toBe(409);
            expect(await state()).toMatchObject({
                version: 1,
                sessionVersion: 1,
                revocationVersion: 1,
                pendingEmail: null,
            });
            expect(await jobs(context.queues.EMAIL_CONFIRMATION)).toEqual([]);
            expect(await evidence(PrincipalAuditAction.EMAIL_CHANGE_REQUESTED)).toEqual([]);
        },
    );

    it.each(['request', 'confirm'] as const)('refuses a stale %s when request and confirmation race', async (loser) => {
        const proof = await pending();
        const writer = app.get<AccountReader>(context.writerToken);
        const load = writer.load.bind(writer);
        const loaded = deferred();
        const resume = deferred();
        vi.spyOn(writer, 'load').mockImplementationOnce(async (id) => {
            const aggregate = await load(id);
            loaded.resolve();
            await resume.promise;
            return aggregate;
        });
        const replacement = { newEmail: 'replacement@example.test', currentPassword: password };
        const losingRequest =
            loser === 'request'
                ? http('POST', '/email/initiate', replacement)
                : http('POST', '/email/confirm', { token: proof.token });
        try {
            await loaded.promise;
            const winner =
                loser === 'request'
                    ? await http('POST', '/email/confirm', { token: proof.token })
                    : await http('POST', '/email/initiate', replacement);
            expect(winner.statusCode).toBe(loser === 'request' ? 200 : 204);
        } finally {
            resume.resolve();
        }
        expect((await losingRequest).statusCode).toBe(409);
        expect(await notices()).toHaveLength(loser === 'request' ? 1 : 0);
        expect(await evidence(PrincipalAuditAction.EMAIL_CHANGED)).toHaveLength(loser === 'request' ? 1 : 0);
        expect(await state()).toMatchObject(
            loser === 'request'
                ? { email: proof.email, pendingEmail: null }
                : { email: account.email, pendingEmail: replacement.newEmail },
        );
    });

    it('rejects expiry reached after JWT verification and before aggregate consumption', async () => {
        const proof = await pending();
        const before = await state();
        // The primary read completes after JWT verification; advance only the consumption clock.
        const writer = app.get<AccountReader>(context.writerToken);
        const load = writer.load.bind(writer);
        vi.spyOn(writer, 'load').mockImplementationOnce(async (id) => {
            const aggregate = await load(id);
            vi.spyOn(Date, 'now').mockReturnValue(proof.claims.exp * 1000);
            return aggregate;
        });
        expect((await http('POST', '/email/confirm', { token: proof.token })).statusCode).toBe(400);
        expect(await state()).toEqual(before);
        expect(await evidence(DomainFailureAuditAction.EMAIL_CHANGE_CONFIRMATION_FAILED)).toEqual([]);
        expect(await notices()).toEqual([]);
    });

    it.each(['banned', 'deleted', 'expired', 'revoked', 'cleared', 'missing'] as const)(
        'skips %s confirmation deliveries without emails or refusal audits',
        async (reason) => {
            await pending();
            const job = (await jobs(context.queues.EMAIL_CONFIRMATION))[0]!;
            if (reason === 'missing') {
                await database.delete(context.table).where(eq(context.table.id, account.id));
            } else {
                await database
                    .update(context.table)
                    .set({
                        ...(reason === 'banned' ? { isBanned: true } : {}),
                        ...(reason === 'deleted' ? { deletedAt: new Date() } : {}),
                        ...(reason === 'expired' ? { pendingEmailExpiresAt: new Date(Date.now() - 1000) } : {}),
                        ...(reason === 'revoked' ? { revocationVersion: 1, sessionVersion: 1 } : {}),
                        ...(reason === 'cleared'
                            ? {
                                  pendingEmailRequestId: null,
                                  pendingEmail: null,
                                  pendingEmailExpiresAt: null,
                                  pendingEmailRevocationVersion: null,
                              }
                            : {}),
                    })
                    .where(eq(context.table.id, account.id));
            }
            await deliver(job.data);
            expect(sendEmail).not.toHaveBeenCalled();
            expect(await evidence(DomainFailureAuditAction.EMAIL_CHANGE_CONFIRMATION_FAILED)).toEqual([]);
        },
    );

    it('keeps each historical recipient across successive changes and account deletion', async () => {
        const first = await pending();
        const firstResponse = await http('POST', '/email/confirm', { token: first.token });
        expect(firstResponse.statusCode).toBe(200);
        account = { ...account, accessToken: firstResponse.json<{ data: { accessToken: string } }>().data.accessToken };
        const second = await pending();
        expect((await http('POST', '/email/confirm', { token: second.token })).statusCode).toBe(200);
        const records = await notices();
        expect(records.map((row) => row.previousEmail).sort()).toEqual([account.email, first.email].sort());
        const deliveries = await jobs(context.queues.EMAIL_CHANGE_NOTIFICATION);
        expect(deliveries).toHaveLength(2);
        await database.delete(context.table).where(eq(context.table.id, account.id));
        for (const job of deliveries) {
            await notify(job.data);
            await notify(job.data);
            const record = records.find((row) => row.id === job.data.deliveryId)!;
            expect(sendEmail.mock.calls.slice(-2).map((call) => call[0].to)).toEqual([
                record.previousEmail,
                record.previousEmail,
            ]);
        }
        await notify({ aggregateId: account.id, deliveryId: uuidv7() });
        expect(sendEmail).toHaveBeenCalledTimes(4);
    });

    it('preserves durable reconciliation and cache eviction after a post-commit unexpected session error', async () => {
        const proof = await pending();
        const cache = app.get<ICachePort>(TOKEN_CACHE_PORT);
        if (context.kind === PrincipalType.USER) {
            await cache.set(CacheKeys.userById(account.id), { email: account.email }, 60);
        }
        vi.spyOn(sessionPort, 'openSession').mockRejectedValueOnce(new Error('Unexpected session bug'));
        expect((await http('POST', '/email/confirm', { token: proof.token })).statusCode).toBe(500);
        expect((await state()).email).toBe(proof.email);
        expect(await notices()).toHaveLength(1);
        expect(await evidence(PrincipalAuditAction.EMAIL_CHANGED)).toHaveLength(1);
        const reconcile = (await jobs(context.queues.SESSION_RECONCILE))[0]!;
        if (context.kind === PrincipalType.ADMIN) {
            await app.get(AdminSessionQueue).consume(reconcile.data);
        } else {
            await app.get(UserSessionQueue).consume(reconcile.data);
            const eviction = (await jobs(UserJobQueue.CACHE_INVALIDATE))[0]!;
            expect(await cache.get(CacheKeys.userById(account.id))).not.toBeNull();
            await app.get(UserCacheQueue).consume(eviction.data);
            expect(await cache.get(CacheKeys.userById(account.id))).toBeNull();
        }
        expect((await http('GET', '')).statusCode).toBe(401);
    });

    it.each(['confirmation', 'notification'] as const)(
        'retries %s through pg-boss then retains failed delivery identity in the DLQ',
        async (delivery) => {
            const proof = await pending();
            if (delivery === 'notification') {
                expect((await http('POST', '/email/confirm', { token: proof.token })).statusCode).toBe(200);
            }
            const queue =
                delivery === 'confirmation'
                    ? context.queues.EMAIL_CONFIRMATION
                    : context.queues.EMAIL_CHANGE_NOTIFICATION;
            const original = (await jobs(queue))[0]!;
            // Bound retry time on this test job only; production retry defaults remain untouched.
            await boss.deleteJob(queue, original.id);
            const id = await boss.send(queue, original.data, { retryLimit: 1, retryDelay: 0, retryBackoff: false });
            expect(id).not.toBeNull();
            const failure = new Error('Simulated email provider outage');
            sendEmail.mockRejectedValue(failure);
            await boss.work<Job>(queue, { batchSize: 1, pollingIntervalSeconds: 0.5 }, async (batch) => {
                for (const job of batch) {
                    if (delivery === 'confirmation') {
                        await deliver(job.data);
                    } else {
                        await notify(job.data);
                    }
                }
            });
            try {
                await vi.waitFor(
                    async () => {
                        const dead = await jobs(JOB_QUEUE_DEAD_LETTER);
                        expect(dead).toContainEqual(expect.objectContaining({ data: original.data }));
                    },
                    { timeout: 15_000, interval: 100 },
                );
                expect(
                    sendEmail.mock.calls.filter(
                        (call) => call[0].to === (delivery === 'confirmation' ? proof.email : account.email),
                    ),
                ).toHaveLength(2);
                const messages = sendEmail.mock.calls.filter(
                    (call) => call[0].to === (delivery === 'confirmation' ? proof.email : account.email),
                );
                expect(messages[0]![0]).toEqual(messages[1]![0]);
                if (delivery === 'confirmation') {
                    expect(messages[0]![0].body).toContain(proof.token);
                }
                expect((await state()).email).toBe(delivery === 'confirmation' ? account.email : proof.email);
            } finally {
                await boss.offWork(queue);
                sendEmail.mockResolvedValue(undefined);
            }
        },
        20_000,
    );

    it.each(['banned', 'revoked', 'deleted'] as const)(
        'rechecks %s account state even when the session mirror is stale',
        async (reason) => {
            const proof = await pending();
            await database
                .update(context.table)
                .set({
                    ...(reason === 'banned' ? { isBanned: true } : {}),
                    ...(reason === 'revoked' ? { revocationVersion: 1, sessionVersion: 1 } : {}),
                    ...(reason === 'deleted' ? { deletedAt: new Date() } : {}),
                })
                .where(eq(context.table.id, account.id));
            const before = await state();
            expect((await http('POST', '/email/confirm', { token: proof.token })).statusCode).toBe(
                reason === 'banned' ? 403 : reason === 'deleted' ? 404 : 400,
            );
            expect(await state()).toEqual(before);
            expect(await notices()).toEqual([]);
            expect(await evidence(DomainFailureAuditAction.EMAIL_CHANGE_CONFIRMATION_FAILED)).toHaveLength(
                reason === 'banned' ? 1 : 0,
            );
            expect(await evidence(AuditAction.ACCESS_DENIED)).toEqual([]);
        },
    );

    it('keeps refusal evidence when the enclosing mutation and its success audit roll back', async () => {
        const before = await state(),
            refusal = new AccessDeniedException('Injected business refusal'),
            auditPort = app.get<IAuditPort>(TOKEN_AUDIT_PORT);

        await expect(
            app.get<ITransactionPort>(TOKEN_TRANSACTION_PORT).run(async () => {
                await database
                    .update(context.table)
                    .set({ name: 'Rolled back mutation' })
                    .where(eq(context.table.id, account.id));
                await auditPort.record({ action: PrincipalAuditAction.EMAIL_CHANGE_REQUESTED, targetId: account.id });
                await auditPort.record(
                    {
                        action: DomainFailureAuditAction.EMAIL_CHANGE_REQUEST_FAILED,
                        targetId: account.id,
                        reason: 'REFUSAL_FIXTURE',
                    },
                    { markExceptionAsAudited: refusal },
                );
                throw refusal;
            }),
        ).rejects.toBe(refusal);

        expect(await state()).toEqual(before);
        const rows = await database.select().from(audit).where(eq(audit.targetId, account.id));
        expect(rows).toMatchObject([
            {
                action: DomainFailureAuditAction.EMAIL_CHANGE_REQUEST_FAILED,
                targetId: account.id,
                reason: 'REFUSAL_FIXTURE',
            },
        ]);
    });

    it.each(['audit', 'job'] as const)('rolls back a new request when %s persistence fails', async (fault) => {
        const before = await state();
        const failure = new Error('Injected request persistence failure');
        if (fault === 'audit') {
            vi.spyOn(app.get<IAuditPort>(TOKEN_AUDIT_PORT), 'record').mockRejectedValueOnce(failure);
        } else {
            const writer = app.get<IJobQueueWriterPort>(TOKEN_JOB_QUEUE_WRITER_PORT);
            const enqueue = writer.enqueue.bind(writer);
            vi.spyOn(writer, 'enqueue').mockImplementationOnce(async (jobs) => {
                await enqueue(jobs);
                throw failure;
            });
        }
        expect(
            (await http('POST', '/email/initiate', { newEmail: 'rollback@example.test', currentPassword: password }))
                .statusCode,
        ).toBe(500);
        expect(await state()).toEqual(before);
        expect(await jobs(context.queues.EMAIL_CONFIRMATION)).toEqual([]);
        expect(await evidence(PrincipalAuditAction.EMAIL_CHANGE_REQUESTED)).toEqual([]);
    });

    it('enforces all-or-none pending metadata and nonnegative revocation in PostgreSQL', async () => {
        await expect(
            database
                .update(context.table)
                .set({ pendingEmail: 'partial@example.test' })
                .where(eq(context.table.id, account.id)),
        ).rejects.toThrow();
        await pending();
        const before = await state();
        await expect(
            database
                .update(context.table)
                .set({ pendingEmailRevocationVersion: -1 })
                .where(eq(context.table.id, account.id)),
        ).rejects.toThrow();
        expect(await state()).toEqual(before);
    });

    it('logs real requests without their bodies, query tokens or authorization headers', async () => {
        const root = PinoLogger.root;
        const destination = (root as unknown as Record<symbol, DestinationStream>)[symbols.streamSym]!;
        const lines: string[] = [];
        const write = vi.spyOn(destination, 'write').mockImplementation((line) => {
            lines.push(line);
        });
        const previousLevel = root.level;
        root.level = 'info';
        try {
            const proof = await pending();
            expect(
                (await http('POST', `/email/confirm?token=${encodeURIComponent(proof.token)}`, { token: proof.token }))
                    .statusCode,
            ).toBe(200);
            expect(lines.length).toBeGreaterThan(0);
            const serialized = lines.join('');
            for (const sensitive of [
                password,
                hash,
                proof.email,
                account.email,
                proof.token,
                account.accessToken,
                account.refreshToken,
            ]) {
                expect(serialized).not.toContain(sensitive);
            }
        } finally {
            root.level = previousLevel;
            write.mockRestore();
        }
    });

    it.each(['password', 'ban', 'revocation'] as const)(
        'rejects confirmation saved after a concurrent %s change',
        async (change) => {
            const proof = await pending();
            const writer = app.get<AccountReader>(context.writerToken);
            const load = writer.load.bind(writer);
            vi.spyOn(writer, 'load').mockImplementationOnce(async (id) => {
                const aggregate = await load(id);
                await database
                    .update(context.table)
                    .set({
                        version: 2,
                        sessionVersion: 1,
                        revocationVersion: 1,
                        ...(change === 'password' ? { password: 'changed hash' } : {}),
                        ...(change === 'ban' ? { isBanned: true } : {}),
                    })
                    .where(eq(context.table.id, id));
                return aggregate;
            });
            expect((await http('POST', '/email/confirm', { token: proof.token })).statusCode).toBe(409);
            expect(await state()).toMatchObject({
                email: account.email,
                version: 2,
                sessionVersion: 1,
                revocationVersion: 1,
                pendingEmail: proof.email,
            });
            expect(await notices()).toEqual([]);
            expect(await evidence(PrincipalAuditAction.EMAIL_CHANGED)).toEqual([]);
            expect(await jobs(context.queues.EMAIL_CHANGE_NOTIFICATION)).toEqual([]);
        },
    );
});
