/**
 * @file session-revocation-jobs.e2e-spec.ts
 * @description Verifies Auth revocation jobs through pg-boss and the owning aggregate consumers.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PgBoss } from 'pg-boss';
import { resolveEnvFilePath, validateConfig } from 'src/core/config';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { DatabaseModule, TOKEN_DATABASE_CLIENT } from 'src/core/database';
import { JobQueueModule, type Job } from 'src/core/job-queue';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { AuditAction, AuditModule, audit } from 'src/core/observability/audit';
import { runWithAuditContext } from 'src/core/observability/audit/audit-context';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { RotateOutcome, TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { AuthTokenType, TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { TOKEN_ADMIN_WRITER_PORT } from 'src/module/admin/application/command/port/admin-writer.port';
import { RevokeAdminSessionsCommandHandler } from 'src/module/admin/application/command/revoke-admin-sessions/handler';
import { AdminSessionRevocationLogoutAllQueue } from 'src/module/admin/application/queue/admin-session-revocation-logout-all.queue';
import { AdminSessionRevocationRefreshReuseQueue } from 'src/module/admin/application/queue/admin-session-revocation-refresh-reuse.queue';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';
import { AdminWriterAdapter } from 'src/module/admin/infrastructure/adapter/admin-writer.adapter';
import { admin } from 'src/module/admin/infrastructure/admin.schema';
import { LogoutAllCommand } from 'src/module/auth/application/command/logout-all/command';
import { LogoutAllCommandHandler } from 'src/module/auth/application/command/logout-all/handler';
import {
    TOKEN_IDENTITY_READER_PORT,
    type IIdentityReaderPort,
} from 'src/module/auth/application/command/port/identity-reader.port';
import { RefreshTokensCommand } from 'src/module/auth/application/command/refresh-tokens/command';
import { RefreshTokensCommandHandler } from 'src/module/auth/application/command/refresh-tokens/handler';
import { TOKEN_USER_WRITER_PORT } from 'src/module/user/application/command/port/user-writer.port';
import { RevokeUserSessionsCommandHandler } from 'src/module/user/application/command/revoke-user-sessions/handler';
import { UserSessionRevocationLogoutAllQueue } from 'src/module/user/application/queue/user-session-revocation-logout-all.queue';
import { UserSessionRevocationRefreshReuseQueue } from 'src/module/user/application/queue/user-session-revocation-refresh-reuse.queue';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';
import { UserWriterAdapter } from 'src/module/user/infrastructure/adapter/user-writer.adapter';
import { user } from 'src/module/user/infrastructure/user.schema';
import { AdminSessionRevocationJobQueue } from 'src/shared/domain/admin';
import { PrincipalType } from 'src/shared/domain/principal';
import { UserSessionRevocationJobQueue } from 'src/shared/domain/user';
import { UnauthenticatedException } from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Auth dependencies replaced only at the Redis/JWT edges so PostgreSQL, transactions, pg-boss,
 * owner writers, command dispatch, and audit persistence remain real.
 */
const verifyRefreshToken = vi.fn<ITokenPort['verifyRefreshToken']>(),
    refreshTokens = vi.fn<ITokenPort['refreshTokens']>(),
    getAuthState = vi.fn<IIdentityReaderPort['getAuthState']>(),
    rotateSession = vi.fn<ISessionPort['rotateSession']>(),
    tokenPort: ITokenPort = {
        generateTokens: vi.fn(),
        refreshTokens,
        verifyAccessToken: vi.fn(),
        verifyRefreshToken,
        verifyLogoutToken: vi.fn(),
        generateInviteToken: vi.fn(),
        verifyInviteToken: vi.fn(),
    },
    identityReaderPort: IIdentityReaderPort = {
        getCredentialsByEmail: vi.fn(),
        getAuthState,
    },
    sessionPort: ISessionPort = {
        openSession: vi.fn(),
        rotateSession,
        closeSession: vi.fn(),
        isSessionActive: vi.fn(),
        setVersion: vi.fn(),
        getVersion: vi.fn(),
    };

/**
 * Test composition retaining the production application handlers and persistence adapters.
 */
@Module({
    imports: [DatabaseModule, JobQueueModule, AuditModule, CqrsPipelineModule],
    providers: [
        LogoutAllCommandHandler,
        RefreshTokensCommandHandler,
        RevokeAdminSessionsCommandHandler,
        RevokeUserSessionsCommandHandler,
        { provide: TOKEN_ADMIN_WRITER_PORT, useClass: AdminWriterAdapter },
        { provide: TOKEN_USER_WRITER_PORT, useClass: UserWriterAdapter },
        { provide: TOKEN_TOKEN_PORT, useValue: tokenPort },
        { provide: TOKEN_IDENTITY_READER_PORT, useValue: identityReaderPort },
        { provide: TOKEN_SESSION_PORT, useValue: sessionPort },
    ],
    exports: [CqrsPipelineModule],
})
class AuthRevocationJobTestModule {}

/**
 * One Auth producer path and the owner-side effects it must cause.
 */
type RevocationCase = {
    readonly principalType: PrincipalType;
    readonly cause: 'logout-all' | 'refresh-reuse';
    readonly sourceQueue: AdminSessionRevocationJobQueue | UserSessionRevocationJobQueue;
    readonly sessionQueue: AdminJobQueue.SESSION_RECONCILE | UserJobQueue.SESSION_RECONCILE;
    readonly noticeQueue: AdminJobQueue.REFRESH_REUSE_NOTICE | UserJobQueue.REFRESH_REUSE_NOTICE;
    readonly consumerAudit: AuditAction.ADMIN_SESSIONS_REVOKED | AuditAction.USER_SESSIONS_REVOKED;
};

/**
 * All cross-context source queues under test.
 */
const SOURCE_QUEUES = [
    AdminSessionRevocationJobQueue.LOGOUT_ALL,
    AdminSessionRevocationJobQueue.REFRESH_REUSE,
    UserSessionRevocationJobQueue.LOGOUT_ALL,
    UserSessionRevocationJobQueue.REFRESH_REUSE,
] as const;

/**
 * Owner queues receiving follow-up jobs from the revocation aggregate mutation.
 */
const FOLLOW_UP_QUEUES = [
    AdminJobQueue.SESSION_RECONCILE,
    AdminJobQueue.REFRESH_REUSE_NOTICE,
    UserJobQueue.SESSION_RECONCILE,
    UserJobQueue.REFRESH_REUSE_NOTICE,
] as const;

/**
 * Complete routing matrix for both Auth causes and both principal owners.
 */
const CASES: readonly RevocationCase[] = [
    {
        principalType: PrincipalType.USER,
        cause: 'logout-all',
        sourceQueue: UserSessionRevocationJobQueue.LOGOUT_ALL,
        sessionQueue: UserJobQueue.SESSION_RECONCILE,
        noticeQueue: UserJobQueue.REFRESH_REUSE_NOTICE,
        consumerAudit: AuditAction.USER_SESSIONS_REVOKED,
    },
    {
        principalType: PrincipalType.ADMIN,
        cause: 'logout-all',
        sourceQueue: AdminSessionRevocationJobQueue.LOGOUT_ALL,
        sessionQueue: AdminJobQueue.SESSION_RECONCILE,
        noticeQueue: AdminJobQueue.REFRESH_REUSE_NOTICE,
        consumerAudit: AuditAction.ADMIN_SESSIONS_REVOKED,
    },
    {
        principalType: PrincipalType.USER,
        cause: 'refresh-reuse',
        sourceQueue: UserSessionRevocationJobQueue.REFRESH_REUSE,
        sessionQueue: UserJobQueue.SESSION_RECONCILE,
        noticeQueue: UserJobQueue.REFRESH_REUSE_NOTICE,
        consumerAudit: AuditAction.USER_SESSIONS_REVOKED,
    },
    {
        principalType: PrincipalType.ADMIN,
        cause: 'refresh-reuse',
        sourceQueue: AdminSessionRevocationJobQueue.REFRESH_REUSE,
        sessionQueue: AdminJobQueue.SESSION_RECONCILE,
        noticeQueue: AdminJobQueue.REFRESH_REUSE_NOTICE,
        consumerAudit: AuditAction.ADMIN_SESSIONS_REVOKED,
    },
];

describe('Auth session-revocation jobs', () => {
    let module: TestingModule;
    let boss: PgBoss;
    let db: NodePgDatabase;
    let logoutAllHandler: LogoutAllCommandHandler;
    let refreshTokensHandler: RefreshTokensCommandHandler;
    const aggregateIds: string[] = [];
    const report = vi.fn<IErrorReporterPort['report']>();

    beforeAll(async () => {
        const builder = Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({
                    isGlobal: true,
                    envFilePath: resolveEnvFilePath(),
                    validate: validateConfig,
                }),
                AuthRevocationJobTestModule,
                JobQueueModule.forFeature(
                    [
                        AdminSessionRevocationLogoutAllQueue,
                        AdminSessionRevocationRefreshReuseQueue,
                        UserSessionRevocationLogoutAllQueue,
                        UserSessionRevocationRefreshReuseQueue,
                    ],
                    [AuthRevocationJobTestModule],
                ),
            ],
        });

        builder.overrideProvider(TOKEN_ERROR_REPORTER_PORT).useValue({ report });
        module = await builder.compile();
        boss = module.get<PgBoss>(TOKEN_JOB_QUEUE_CLIENT);
        db = module.get<NodePgDatabase>(TOKEN_DATABASE_CLIENT);
        logoutAllHandler = module.get(LogoutAllCommandHandler);
        refreshTokensHandler = module.get(RefreshTokensCommandHandler);

        for (const queueName of FOLLOW_UP_QUEUES) {
            await boss.createQueue(queueName, { policy: 'standard' });
        }

        await module.init();
    });

    afterAll(async () => {
        if (!module || !boss || !db) {
            return;
        }

        for (const queueName of SOURCE_QUEUES) {
            await boss.offWork(queueName);
        }

        for (const queueName of [...SOURCE_QUEUES, ...FOLLOW_UP_QUEUES]) {
            for (const aggregateId of aggregateIds) {
                const jobs = await boss.findJobs<Job>(queueName, { data: { aggregateId } });

                if (jobs.length > 0) {
                    await boss.deleteJob(
                        queueName,
                        jobs.map((job) => job.id),
                    );
                }
            }
        }

        for (const aggregateId of aggregateIds) {
            await db.delete(audit).where(or(eq(audit.actorId, aggregateId), eq(audit.targetId, aggregateId)));
            await db.delete(admin).where(eq(admin.id, aggregateId));
            await db.delete(user).where(eq(user.id, aggregateId));
        }

        await module.close();
    });

    it.each(CASES)(
        'delivers $cause for $principalType only through its owner queue and commits every owner effect',
        async ({ principalType, cause, sourceQueue, sessionQueue, noticeQueue, consumerAudit }) => {
            const aggregateId = uuidv7();
            aggregateIds.push(aggregateId);
            await insertPrincipal(aggregateId, principalType);

            if (cause === 'logout-all') {
                await runWithAuditContext(
                    {
                        actorId: aggregateId,
                        actorType: principalType,
                        remoteAddress: '127.0.0.1',
                        route: '/test/auth/logout-all',
                        method: 'POST',
                    },
                    () => logoutAllHandler.execute(new LogoutAllCommand(aggregateId, principalType)),
                );
            } else {
                verifyRefreshToken.mockResolvedValueOnce({
                    sub: aggregateId,
                    principalType,
                    sid: uuidv7(),
                    sessionExpiresAt: 2_000_000_000,
                    exp: 1_900_000_000,
                    jti: uuidv7(),
                    sessionVersion: 0,
                    type: AuthTokenType.REFRESH,
                });
                getAuthState.mockResolvedValueOnce({
                    permissions: [],
                    isBanned: false,
                    sessionVersion: 0,
                    revocationVersion: 0,
                });
                refreshTokens.mockResolvedValueOnce({
                    accessToken: 'unused-access-token',
                    refreshToken: 'unused-refresh-token',
                    session: {
                        sid: uuidv7(),
                        sessionExpiresAt: 2_000_000_000,
                        sessionVersion: 0,
                        principalType,
                        refreshTokenJti: uuidv7(),
                        refreshExpiresAt: 1_900_000_000,
                    },
                });
                rotateSession.mockResolvedValueOnce(RotateOutcome.REUSE_DETECTED);

                await expect(
                    refreshTokensHandler.execute(new RefreshTokensCommand('reused-refresh-token')),
                ).rejects.toBeInstanceOf(UnauthenticatedException);
            }

            await expect
                .poll(async () => (await findJobs(sourceQueue, aggregateId))[0]?.state, {
                    timeout: 15_000,
                    interval: 100,
                })
                .toBe('completed');

            const sourceJobs = await findJobs(sourceQueue, aggregateId),
                ownerState = await readPrincipalState(aggregateId, principalType),
                auditRows = await db
                    .select({ action: audit.action })
                    .from(audit)
                    .where(or(eq(audit.actorId, aggregateId), eq(audit.targetId, aggregateId))),
                sessionJobs = await findJobs(sessionQueue, aggregateId),
                noticeJobs = await findJobs(noticeQueue, aggregateId),
                expectedProducerAudit =
                    cause === 'logout-all' ? AuditAction.LOGOUT_ALL : AuditAction.REFRESH_REUSE_DETECTED;

            expect(sourceJobs).toHaveLength(1);
            expect(sourceJobs[0]?.data.deliveryId).toMatch(/^[0-9a-f-]{36}$/);
            expect(sourceJobs[0]?.data).toEqual({
                deliveryId: sourceJobs[0]?.data.deliveryId,
                aggregateId,
            });
            expect(ownerState).toEqual({ version: 1, sessionVersion: 1, revocationVersion: 1 });
            expect(auditRows.map(({ action }) => action).sort()).toEqual([consumerAudit, expectedProducerAudit].sort());
            expect(sessionJobs).toHaveLength(1);
            expect(sessionJobs[0]?.data.aggregateId).toBe(aggregateId);
            expect(noticeJobs).toHaveLength(cause === 'refresh-reuse' ? 1 : 0);

            for (const wrongSourceQueue of SOURCE_QUEUES.filter((queueName) => queueName !== sourceQueue)) {
                await expect(findJobs(wrongSourceQueue, aggregateId)).resolves.toHaveLength(0);
            }

            const wrongOwnerQueues = FOLLOW_UP_QUEUES.filter(
                (queueName) => queueName !== sessionQueue && queueName !== noticeQueue,
            );
            for (const wrongOwnerQueue of wrongOwnerQueues) {
                await expect(findJobs(wrongOwnerQueue, aggregateId)).resolves.toHaveLength(0);
            }
        },
        20_000,
    );

    /**
     * Inserts one active principal at version zero.
     *
     * @param aggregateId Principal identifier
     * @param principalType Owning context
     */
    async function insertPrincipal(aggregateId: string, principalType: PrincipalType) {
        const values = {
            id: aggregateId,
            email: `${aggregateId}@example.test`,
            name: 'Auth queue integration test',
            password: 'not-used-by-this-test',
        };

        if (principalType === PrincipalType.ADMIN) {
            await db.insert(admin).values(values);
        } else {
            await db.insert(user).values(values);
        }
    }

    /**
     * Reads the persisted optimistic-lock and session counters.
     *
     * @param aggregateId Principal identifier
     * @param principalType Owning context
     * @returns Persisted versions after owner consumption
     */
    async function readPrincipalState(aggregateId: string, principalType: PrincipalType) {
        const selection = {
            version: user.version,
            sessionVersion: user.sessionVersion,
            revocationVersion: user.revocationVersion,
        };

        if (principalType === PrincipalType.ADMIN) {
            return (
                await db
                    .select({
                        version: admin.version,
                        sessionVersion: admin.sessionVersion,
                        revocationVersion: admin.revocationVersion,
                    })
                    .from(admin)
                    .where(eq(admin.id, aggregateId))
            )[0];
        }

        return (await db.select(selection).from(user).where(eq(user.id, aggregateId)))[0];
    }

    /**
     * Finds jobs belonging to one test principal in a named queue.
     *
     * @param queueName Queue to inspect
     * @param aggregateId Test principal identifier
     * @returns Matching persisted jobs
     */
    function findJobs(queueName: string, aggregateId: string) {
        return boss.findJobs<Job>(queueName, { data: { aggregateId } });
    }
});
