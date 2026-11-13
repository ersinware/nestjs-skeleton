/**
 * @file handler.spec.ts
 * @description Refresh propagation of immutable session identity, account revocation, and atomic decisions.
 */

import { randomUUID } from 'node:crypto';
import type { ITransactionPort } from 'src/core/database';
import type { IJobQueueWriterPort } from 'src/core/job-queue';
import { type IAuditPort } from 'src/core/observability/audit';
import { ReplaySessionOutcome, RotateSessionOutcome, type ISessionPort } from 'src/core/security/session';
import { AuthTokenType, type ITokenPort } from 'src/core/security/token';
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
    const verifyRefreshTokenForReplay = vi.fn<ITokenPort['verifyRefreshTokenForReplay']>();
    const generateTokens = vi.fn<ITokenPort['generateTokens']>();
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
        refreshTokenJti: 'new-jti',
        principalType: PrincipalType.USER,
        refreshExpiresAt: 1900000000,
        accessExpiresAt: 1800000000,
    };
    let handler: RefreshTokensCommandHandler;

    beforeEach(() => {
        findSessionRequestReplay.mockResolvedValue({ outcome: ReplaySessionOutcome.NOT_FOUND, session: null });
        verifyRefreshTokenForReplay.mockResolvedValue({
            sub: 'user-1',
            principalType: PrincipalType.USER,
            sid: session.sid,
            sessionExpiresAt: session.sessionExpiresAt,
            exp: 1900000000,
            jti: 'old-jti',
            sessionVersion: 1,
            type: AuthTokenType.REFRESH,
        });
        getRefreshState.mockResolvedValue({
            sessionVersion: 2,
            permissions: [Permission.HEALTH_DETAIL_READ],
        });
        rotateSession.mockResolvedValue({
            outcome: RotateSessionOutcome.ROTATED,
            session,
            accessExpiresAt: session.accessExpiresAt,
        });
        generateTokens.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
        enqueue.mockResolvedValue(undefined);
        start.mockImplementation(async (cb: () => Promise<unknown>) => cb());
        handler = new RefreshTokensCommandHandler(
            { verifyRefreshTokenForReplay, generateTokens } as unknown as ITokenPort,
            { getRefreshState } as unknown as IIdentityReaderPort,
            { findSessionRequestReplay, rotateSession } as unknown as ISessionPort,
            { enqueue },
            { start, join: vi.fn() } as unknown as ITransactionPort,
            { record },
        );
    });

    it('preserves the original session while refreshing permissions at the current version', async () => {
        expect(
            await handler.execute(
                new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'refresh-fixture' }, 'old'),
            ),
        ).toEqual({
            accessToken: 'access',
            refreshToken: 'refresh',
        });
        expect(getRefreshState).toHaveBeenCalledWith(PrincipalType.USER, 'user-1', 1);
        expect(rotateSession).toHaveBeenCalledWith(
            expect.objectContaining({ canonicalValue: 'refresh-fixture' }),
            'user-1',
            'old-jti',
            {
                principalType: PrincipalType.USER,
                sessionVersion: 2,
                sid: session.sid,
                sessionExpiresAt: session.sessionExpiresAt,
            },
        );
    });

    it('rejects an ineligible or missing account before signing or rotation without refusal audit', async () => {
        getRefreshState.mockRejectedValueOnce(new ResourceNotFoundException());
        await expect(
            handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'refresh-fixture' }, 'old')),
        ).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(generateTokens).not.toHaveBeenCalled();
        expect(rotateSession).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('propagates unavailable identity storage without signing or rotation', async () => {
        const failure = new DependencyUnavailableException();
        getRefreshState.mockRejectedValueOnce(failure);
        await expect(
            handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'refresh-fixture' }, 'old')),
        ).rejects.toBe(failure);
        expect(generateTokens).not.toHaveBeenCalled();
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
        verifyRefreshTokenForReplay.mockResolvedValueOnce({
            sub: 'principal-1',
            principalType,
            sid: session.sid,
            sessionExpiresAt: session.sessionExpiresAt,
            exp: 1900000000,
            jti: 'old-jti',
            sessionVersion: 1,
            type: AuthTokenType.REFRESH,
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
                accessExpiresAt: session.accessExpiresAt,
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
            expect(generateTokens).toHaveBeenCalledWith(
                expect.objectContaining({ sid: session.sid, sessionVersion: 2 }),
                expect.objectContaining({ jti: session.refreshTokenJti, exp: session.refreshExpiresAt }),
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
        const payload = await verifyRefreshTokenForReplay('fixture');
        verifyRefreshTokenForReplay.mockResolvedValueOnce({ ...payload, exp: 1 });
        if (retained) {
            findSessionRequestReplay.mockResolvedValueOnce({
                outcome: ReplaySessionOutcome.REPLAYED,
                session,
                accessExpiresAt: session.accessExpiresAt,
            });
            await expect(
                handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'fixture' }, 'old')),
            ).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });
        } else {
            await expect(
                handler.execute(new RefreshTokensCommand({ key: randomUUID(), canonicalValue: 'fixture' }, 'old')),
            ).rejects.toBeInstanceOf(UnauthenticatedException);
            expect(getRefreshState).not.toHaveBeenCalled();
            expect(generateTokens).not.toHaveBeenCalled();
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
        expect(generateTokens).not.toHaveBeenCalled();
        expect(rotateSession).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
    });
});
