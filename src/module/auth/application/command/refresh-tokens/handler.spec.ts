/**
 * @file handler.spec.ts
 * @description Refresh propagation of immutable session identity, account revocation, and atomic decisions.
 */

import type { ITransactionPort } from 'src/core/database';
import { AuditAction, type IAuditPort } from 'src/core/observability/audit';
import type { IOutboxWriterPort } from 'src/core/outbox';
import { RotateOutcome, type ISessionPort } from 'src/core/security/session';
import { AuthTokenType, type ITokenPort } from 'src/core/security/token';
import type { IIdentityReaderPort } from 'src/module/auth/application/command/port/identity-reader.port';
import { RefreshTokensCommand } from 'src/module/auth/application/command/refresh-tokens/command';
import { RefreshTokensCommandHandler } from 'src/module/auth/application/command/refresh-tokens/handler';
import { Permission, PrincipalType } from 'src/shared/domain/principal';
import {
    DependencyUnavailableException,
    ResourceConflictException,
    UnauthenticatedException,
} from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('RefreshTokensCommandHandler', () => {
    const verifyRefreshToken = vi.fn<ITokenPort['verifyRefreshToken']>();
    const refreshTokens = vi.fn<ITokenPort['refreshTokens']>();
    const getAuthState = vi.fn<IIdentityReaderPort['getAuthState']>();
    const rotateSession = vi.fn<ISessionPort['rotateSession']>();
    const save = vi.fn<IOutboxWriterPort['save']>();
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
        getAuthState.mockResolvedValue({
            isBanned: false,
            sessionVersion: 2,
            revocationVersion: 1,
            permissions: [Permission.HEALTH_DETAIL_READ],
        });
        rotateSession.mockResolvedValue(RotateOutcome.ROTATED);
        save.mockResolvedValue(undefined);
        run.mockImplementation(async (cb: () => Promise<unknown>) => cb());
        handler = new RefreshTokensCommandHandler(
            { verifyRefreshToken, refreshTokens } as unknown as ITokenPort,
            { getAuthState } as unknown as IIdentityReaderPort,
            { rotateSession } as unknown as ISessionPort,
            { save },
            { run } as unknown as ITransactionPort,
            { record },
        );
    });

    it('preserves the original session while refreshing permissions at the current version', async () => {
        expect(await handler.execute(new RefreshTokensCommand('old'))).toEqual({
            accessToken: 'access',
            refreshToken: 'refresh',
        });
        expect(refreshTokens).toHaveBeenCalledWith(
            { id: 'user-1', type: PrincipalType.USER, permissions: [Permission.HEALTH_DETAIL_READ] },
            2,
            { sid: session.sid, sessionExpiresAt: session.sessionExpiresAt },
        );
        expect(rotateSession).toHaveBeenCalledWith('user-1', 'old-jti', session);
    });

    it.each([
        { isBanned: true, revocationVersion: 1 },
        { isBanned: false, revocationVersion: 2 },
    ])('rejects authoritative account refusal before signing or rotation', async (state) => {
        getAuthState.mockResolvedValueOnce({ ...state, sessionVersion: 2, permissions: [] });
        await expect(handler.execute(new RefreshTokensCommand('old'))).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(refreshTokens).not.toHaveBeenCalled();
        expect(rotateSession).not.toHaveBeenCalled();
    });

    it('does not treat logout or expiry as a new account-wide reuse event', async () => {
        rotateSession.mockResolvedValueOnce(RotateOutcome.SESSION_CLOSED);
        await expect(handler.execute(new RefreshTokensCommand('old'))).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(save).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('audits grace replay without returning the candidate tokens or requesting revocation', async () => {
        rotateSession.mockResolvedValueOnce(RotateOutcome.CONCURRENT_REPLAY);
        await expect(handler.execute(new RefreshTokensCommand('old'))).rejects.toBeInstanceOf(
            ResourceConflictException,
        );
        expect(record).toHaveBeenCalledWith({ action: AuditAction.REFRESH_CONCURRENT_REPLAY, targetId: 'user-1' });
        expect(save).not.toHaveBeenCalled();
    });

    it('requests wider revocation after the store has closed a reused session', async () => {
        rotateSession.mockResolvedValueOnce(RotateOutcome.REUSE_DETECTED);
        await expect(handler.execute(new RefreshTokensCommand('old'))).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(save).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith({ action: AuditAction.REFRESH_REUSE_DETECTED, targetId: 'user-1' });
    });

    it('does not return generated tokens after a required session failure', async () => {
        const failure = new DependencyUnavailableException();
        rotateSession.mockRejectedValueOnce(failure);
        await expect(handler.execute(new RefreshTokensCommand('old'))).rejects.toBe(failure);
        expect(save).not.toHaveBeenCalled();
    });
});
