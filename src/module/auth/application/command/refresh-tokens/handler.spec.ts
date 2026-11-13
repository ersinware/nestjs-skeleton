/**
 * @file handler.spec.ts
 * @description Refresh propagation of immutable session identity, account revocation, and atomic decisions.
 */

import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { ENV } from 'src/core/config';
import type { ITransactionPort } from 'src/core/database';
import type { IJobQueueWriterPort } from 'src/core/job-queue';
import { type IAuditPort } from 'src/core/observability/audit';
import {
    ACCESS_TOKEN_TYPE,
    AccessTokenLifetimePolicy,
    REFRESH_TOKEN_TYPE,
    type RefreshTokenPayload,
} from 'src/core/security/auth';
import type { IHashingPort } from 'src/core/security/hashing';
import { ReplaySessionOutcome, RotateSessionOutcome, type ISessionPort } from 'src/core/security/session';
import type { ITokenPort, TokenVerifyOptions } from 'src/core/security/token';
import type { IIdentityReaderPort } from 'src/module/auth/application/command/port/identity-reader.port';
import { RefreshTokensCommand } from 'src/module/auth/application/command/refresh-tokens/command';
import { RefreshTokensCommandHandler } from 'src/module/auth/application/command/refresh-tokens/handler';
import { AuthAuditAction } from 'src/module/auth/shared/auth-audit';
import { AdminSessionRevocationJobQueue } from 'src/shared/domain/admin';
import { Permission, PrincipalType } from 'src/shared/domain/principal';
import { UserSessionRevocationJobQueue } from 'src/shared/domain/user';
import {
    DependencyUnavailableException,
    ResourceConflictException,
    ResourceNotFoundException,
    UnauthenticatedException,
} from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('RefreshTokensCommandHandler', () => {
    const accessSign = vi.fn<ITokenPort<typeof ACCESS_TOKEN_TYPE>['sign']>();
    const refreshVerify =
        vi.fn<
            (
                token: string,
                expectedType: typeof REFRESH_TOKEN_TYPE,
                options?: TokenVerifyOptions,
            ) => Promise<RefreshTokenPayload>
        >();
    const refreshSign = vi.fn<ITokenPort<typeof REFRESH_TOKEN_TYPE>['sign']>();
    const hmacSha256 = vi.fn<IHashingPort['hmacSha256']>();
    const getRefreshState = vi.fn<IIdentityReaderPort['getRefreshState']>();
    const findSessionRequestReplay = vi.fn<ISessionPort['findSessionRequestReplay']>();
    const rotateSession = vi.fn<ISessionPort['rotateSession']>();
    const enqueue = vi.fn<IJobQueueWriterPort['enqueue']>();
    const start = vi.fn<ITransactionPort['start']>();
    const record = vi.fn<IAuditPort['record']>();
    const session = {
        sessionVersion: 2,
        sid: 'stable-session',
        sessionExpiresAt: 2000000000,
        refreshCredentialId: 'new-jti',
        principalType: PrincipalType.USER,
        refreshExpiresAt: 1900000000,
    };
    let handler: RefreshTokensCommandHandler;

    beforeEach(() => {
        findSessionRequestReplay.mockResolvedValue({ outcome: ReplaySessionOutcome.NOT_FOUND, session: null });
        refreshVerify.mockResolvedValue({
            sub: 'user-1',
            principalType: PrincipalType.USER,
            sid: session.sid,
            sessionExpiresAt: session.sessionExpiresAt,
            exp: 1900000000,
            jti: 'old-jti',
            sessionVersion: 1,
            type: REFRESH_TOKEN_TYPE,
        });
        hmacSha256.mockReturnValue('fingerprint');
        getRefreshState.mockResolvedValue({
            sessionVersion: 2,
            permissions: [Permission.HEALTH_DETAIL_READ],
        });
        rotateSession.mockResolvedValue({
            outcome: RotateSessionOutcome.ROTATED,
            session,
        });
        accessSign.mockResolvedValue('access');
        refreshSign.mockResolvedValue('refresh');
        enqueue.mockResolvedValue(undefined);
        start.mockImplementation(async (cb: () => Promise<unknown>) => cb());
        handler = new RefreshTokensCommandHandler(
            { sign: accessSign } as unknown as ITokenPort<typeof ACCESS_TOKEN_TYPE>,
            { verify: refreshVerify, sign: refreshSign } as unknown as ITokenPort<typeof REFRESH_TOKEN_TYPE>,
            { hmacSha256 } as unknown as IHashingPort,
            { getRefreshState } as unknown as IIdentityReaderPort,
            { findSessionRequestReplay, rotateSession } as unknown as ISessionPort,
            { enqueue },
            { start, join: vi.fn() } as unknown as ITransactionPort,
            { record },
            new AccessTokenLifetimePolicy(new ConfigService({ [ENV.JWT_ACCESS_TTL]: '15m' })),
        );
    });

    it('preserves the original session while refreshing permissions at the current version', async () => {
        const key = randomUUID();
        expect(
            await handler.execute(new RefreshTokensCommand({ key, canonicalValue: 'refresh-fixture' }, 'old')),
        ).toEqual({
            accessToken: 'access',
            refreshToken: 'refresh',
        });
        expect(getRefreshState).toHaveBeenCalledWith(PrincipalType.USER, 'user-1', 1);
        expect(rotateSession).toHaveBeenCalledWith({ key, fingerprint: 'fingerprint' }, 'user-1', 'old-jti', {
            principalType: PrincipalType.USER,
            sessionVersion: 2,
            sid: session.sid,
            sessionExpiresAt: session.sessionExpiresAt,
        });
    });

    it('rejects an ineligible or missing account before signing or rotation without refusal audit', async () => {
        getRefreshState.mockRejectedValueOnce(new ResourceNotFoundException());
        await expect(
            handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'refresh-fixture' }, 'old')),
        ).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(accessSign).not.toHaveBeenCalled();
        expect(refreshSign).not.toHaveBeenCalled();
        expect(rotateSession).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it.each([0, 1])('rejects absolute expiry before retained replay: %s seconds', async (elapsed) => {
        vi.spyOn(Date, 'now').mockReturnValue((session.sessionExpiresAt + elapsed) * 1000);
        findSessionRequestReplay.mockResolvedValue({ outcome: ReplaySessionOutcome.REPLAYED, session });

        await expect(
            handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'refresh' }, 'old')),
        ).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(findSessionRequestReplay).not.toHaveBeenCalled();
        expect(getRefreshState).not.toHaveBeenCalled();
        expect(rotateSession).not.toHaveBeenCalled();
        expect(accessSign).not.toHaveBeenCalled();
        expect(refreshSign).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('propagates unavailable identity storage without signing or rotation', async () => {
        const failure = new DependencyUnavailableException();
        getRefreshState.mockRejectedValueOnce(failure);
        await expect(
            handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'refresh-fixture' }, 'old')),
        ).rejects.toBe(failure);
        expect(accessSign).not.toHaveBeenCalled();
        expect(refreshSign).not.toHaveBeenCalled();
        expect(rotateSession).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('does not treat logout or expiry as new account-wide reuse', async () => {
        rotateSession.mockResolvedValueOnce({ outcome: RotateSessionOutcome.SESSION_CLOSED, session: null });
        await expect(
            handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'refresh-fixture' }, 'old')),
        ).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(enqueue).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('audits grace replay without returning the candidate tokens or requesting revocation', async () => {
        rotateSession.mockResolvedValueOnce({ outcome: RotateSessionOutcome.CONCURRENT_REPLAY, session: null });
        await expect(
            handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'refresh-fixture' }, 'old')),
        ).rejects.toBeInstanceOf(ResourceConflictException);
        expect(record).toHaveBeenCalledWith({
            action: AuthAuditAction.REFRESH_CONCURRENT_REPLAY,
            targetId: 'user-1',
        });
        expect(enqueue).not.toHaveBeenCalled();
    });

    it.each([
        { principalType: PrincipalType.USER, queueName: UserSessionRevocationJobQueue.REFRESH_REUSE },
        { principalType: PrincipalType.ADMIN, queueName: AdminSessionRevocationJobQueue.REFRESH_REUSE },
    ])('routes $principalType reuse remediation to its owner queue', async ({ principalType, queueName }) => {
        refreshVerify.mockResolvedValueOnce({
            sub: 'principal-1',
            principalType,
            sid: session.sid,
            sessionExpiresAt: session.sessionExpiresAt,
            exp: 1900000000,
            jti: 'old-jti',
            sessionVersion: 1,
            type: REFRESH_TOKEN_TYPE,
        });
        rotateSession.mockResolvedValueOnce({ outcome: RotateSessionOutcome.REUSE_DETECTED, session: null });

        await expect(
            handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'refresh-fixture' }, 'old')),
        ).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(start).toHaveBeenCalledTimes(1);
        const job = enqueue.mock.calls[0]?.[0][0];
        expect(job?.deliveryId).toMatch(/^[0-9a-f-]{36}$/);
        expect(job).toMatchObject({ aggregateId: 'principal-1', queueName });
        expect(record).toHaveBeenCalledWith({
            action: AuthAuditAction.REFRESH_REUSE_DETECTED,
            targetId: 'principal-1',
            detail: { deliveryId: job?.deliveryId },
        });
    });

    it('does not return generated tokens after a required session failure', async () => {
        const failure = new DependencyUnavailableException();
        rotateSession.mockRejectedValueOnce(failure);
        await expect(
            handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'refresh-fixture' }, 'old')),
        ).rejects.toBe(failure);
        expect(enqueue).not.toHaveBeenCalled();
    });
    it.each(['pre-read', 'mutation'] as const)(
        'replays %s success using the winning version without reuse remediation',
        async (boundary) => {
            const replay = {
                outcome: ReplaySessionOutcome.REPLAYED,
                session,
            } as const;
            if (boundary === 'pre-read') {
                findSessionRequestReplay.mockResolvedValueOnce(replay);
            } else {
                rotateSession.mockResolvedValueOnce(replay);
            }
            await expect(
                handler.execute(
                    new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'refresh-fixture' }, 'old'),
                ),
            ).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });
            expect(getRefreshState).toHaveBeenLastCalledWith(PrincipalType.USER, 'user-1', session.sessionVersion);
            expect(accessSign).toHaveBeenCalledWith(
                ACCESS_TOKEN_TYPE,
                expect.objectContaining({
                    sub: 'user-1',
                    sid: session.sid,
                    sessionVersion: 2,
                    permissions: [Permission.HEALTH_DETAIL_READ],
                    exp: expect.any(Number) as number,
                }),
            );
            expect(refreshSign).toHaveBeenCalledWith(
                REFRESH_TOKEN_TYPE,
                expect.objectContaining({
                    sub: 'user-1',
                    sid: session.sid,
                    jti: session.refreshCredentialId,
                    sessionVersion: 2,
                    sessionExpiresAt: session.sessionExpiresAt,
                    exp: session.refreshExpiresAt,
                }),
            );
            if (boundary === 'pre-read') {
                expect(rotateSession).not.toHaveBeenCalled();
            }
            expect(record).not.toHaveBeenCalled();
            expect(enqueue).not.toHaveBeenCalled();
            expect(start).not.toHaveBeenCalled();
        },
    );

    it.each([true, false])('admits expired input only with retained live success: %s', async (retained) => {
        const payload = await refreshVerify('fixture', REFRESH_TOKEN_TYPE, { ignoreExpiration: true });
        refreshVerify.mockResolvedValueOnce({ ...payload, exp: 1 });
        if (retained) {
            findSessionRequestReplay.mockResolvedValueOnce({
                outcome: ReplaySessionOutcome.REPLAYED,
                session,
            });
            await expect(
                handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'fixture' }, 'old')),
            ).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });
        } else {
            await expect(
                handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'fixture' }, 'old')),
            ).rejects.toBeInstanceOf(UnauthenticatedException);
            expect(getRefreshState).not.toHaveBeenCalled();
            expect(accessSign).not.toHaveBeenCalled();
            expect(refreshSign).not.toHaveBeenCalled();
        }
        expect(rotateSession).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it.each([
        ReplaySessionOutcome.CONFLICT,
        ReplaySessionOutcome.REPLAY_UNAVAILABLE,
        ReplaySessionOutcome.SESSION_UNAVAILABLE,
        ReplaySessionOutcome.VERSION_SUPERSEDED,
    ] as const)('rejects retained %s without signing, rotation or remediation', async (outcome) => {
        findSessionRequestReplay.mockResolvedValueOnce({ outcome, session: null });
        await expect(
            handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'fixture' }, 'old')),
        ).rejects.toBeInstanceOf(
            outcome === ReplaySessionOutcome.CONFLICT ? ResourceConflictException : UnauthenticatedException,
        );
        expect(accessSign).not.toHaveBeenCalled();
        expect(refreshSign).not.toHaveBeenCalled();
        expect(rotateSession).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
    });
});
