/**
 * @file handler.spec.ts
 * @description Refresh propagation of immutable session identity, account revocation, and atomic decisions.
 */

import type { ITransactionPort } from 'src/core/database';
import type { IJobQueueWriterPort } from 'src/core/job-queue';
import { type IAuditPort } from 'src/core/observability/audit';
import { RotateOutcome, type ISessionPort } from 'src/core/security/session';
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
    const verifyRefreshToken = vi.fn<ITokenPort['verifyRefreshToken']>();
    const refreshTokens = vi.fn<ITokenPort['refreshTokens']>();
    const getRefreshState = vi.fn<IIdentityReaderPort['getRefreshState']>();
    const rotateSession = vi.fn<ISessionPort['rotateSession']>();
    const enqueue = vi.fn<IJobQueueWriterPort['enqueue']>();
    const run = vi.fn<ITransactionPort['run']>();
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
        verifyRefreshToken.mockResolvedValue({
            sub: 'user-1',
            principalType: PrincipalType.USER,
            sid: session.sid,
            sessionExpiresAt: session.sessionExpiresAt,
            exp: 1900000000,
            jti: 'old-jti',
            sessionVersion: 1,
            type: AuthTokenType.REFRESH,
        });
        refreshTokens.mockResolvedValue({
            accessToken: 'access',
            refreshToken: 'refresh',
            session,
        });
        getRefreshState.mockResolvedValue({
            sessionVersion: 2,
            permissions: [Permission.HEALTH_DETAIL_READ],
        });
        rotateSession.mockResolvedValue(RotateOutcome.ROTATED);
        enqueue.mockResolvedValue(undefined);
        run.mockImplementation(async (cb: () => Promise<unknown>) => cb());
        handler = new RefreshTokensCommandHandler(
            { verifyRefreshToken, refreshTokens } as unknown as ITokenPort,
            { getRefreshState } as unknown as IIdentityReaderPort,
            { rotateSession } as unknown as ISessionPort,
            { enqueue },
            { run } as unknown as ITransactionPort,
            { record },
        );
    });

    it('preserves the original session while refreshing permissions at the current version', async () => {
        expect(await handler.execute(new RefreshTokensCommand('old'))).toEqual({
            accessToken: 'access',
            refreshToken: 'refresh',
        });
        expect(getRefreshState).toHaveBeenCalledWith(PrincipalType.USER, 'user-1', 1);
        expect(refreshTokens).toHaveBeenCalledWith(
            { id: 'user-1', type: PrincipalType.USER, permissions: [Permission.HEALTH_DETAIL_READ] },
            2,
            { sid: session.sid, sessionExpiresAt: session.sessionExpiresAt },
        );
        expect(rotateSession).toHaveBeenCalledWith('user-1', 'old-jti', session);
    });

    it('rejects an ineligible or missing account before signing or rotation without refusal audit', async () => {
        getRefreshState.mockRejectedValueOnce(new ResourceNotFoundException());
        await expect(handler.execute(new RefreshTokensCommand('old'))).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(refreshTokens).not.toHaveBeenCalled();
        expect(rotateSession).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('propagates unavailable identity storage without signing or rotation', async () => {
        const failure = new DependencyUnavailableException();
        getRefreshState.mockRejectedValueOnce(failure);
        await expect(handler.execute(new RefreshTokensCommand('old'))).rejects.toBe(failure);
        expect(refreshTokens).not.toHaveBeenCalled();
        expect(rotateSession).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('does not treat logout or expiry as new account-wide reuse', async () => {
        rotateSession.mockResolvedValueOnce(RotateOutcome.SESSION_CLOSED);
        await expect(handler.execute(new RefreshTokensCommand('old'))).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(enqueue).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('audits grace replay without returning the candidate tokens or requesting revocation', async () => {
        rotateSession.mockResolvedValueOnce(RotateOutcome.CONCURRENT_REPLAY);
        await expect(handler.execute(new RefreshTokensCommand('old'))).rejects.toBeInstanceOf(
            ResourceConflictException,
        );
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
        verifyRefreshToken.mockResolvedValueOnce({
            sub: 'principal-1',
            principalType,
            sid: session.sid,
            sessionExpiresAt: session.sessionExpiresAt,
            exp: 1900000000,
            jti: 'old-jti',
            sessionVersion: 1,
            type: AuthTokenType.REFRESH,
        });
        rotateSession.mockResolvedValueOnce(RotateOutcome.REUSE_DETECTED);

        await expect(handler.execute(new RefreshTokensCommand('old'))).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(run).toHaveBeenCalledTimes(1);
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
        await expect(handler.execute(new RefreshTokensCommand('old'))).rejects.toBe(failure);
        expect(enqueue).not.toHaveBeenCalled();
    });
});
