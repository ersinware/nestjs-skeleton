/**
 * @file handler.spec.ts
 * @description Logout proof, stable identity, idempotency, and required session persistence.
 */

import { AuditAction, type IAuditPort } from 'src/core/observability/audit';
import type { ISessionPort } from 'src/core/security/session';
import { AuthTokenType, type ITokenPort } from 'src/core/security/token';
import { LogoutCommand } from 'src/module/auth/application/command/logout/command';
import { LogoutCommandHandler } from 'src/module/auth/application/command/logout/handler';
import { PrincipalType } from 'src/shared/domain/principal';
import { DependencyUnavailableException, UnauthenticatedException } from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('LogoutCommandHandler', () => {
    const verifyLogoutToken = vi.fn<ITokenPort['verifyLogoutToken']>();
    const closeSession = vi.fn<ISessionPort['closeSession']>();
    const record = vi.fn<IAuditPort['record']>();
    let handler: LogoutCommandHandler;

    beforeEach(() => {
        verifyLogoutToken.mockResolvedValue({
            sub: 'user-1',
            principalType: PrincipalType.USER,
            sid: 'stable-session',
            jti: 'old-credential',
            sessionVersion: 1,
            exp: 1,
            sessionExpiresAt: 2000000000,
            type: AuthTokenType.REFRESH,
        });
        closeSession.mockResolvedValue(undefined);
        handler = new LogoutCommandHandler(
            { verifyLogoutToken } as unknown as ITokenPort,
            { closeSession } as unknown as ISessionPort,
            { record },
        );
    });

    it('closes the signed stable session without access credentials or a current refresh jti', async () => {
        await handler.execute(new LogoutCommand('old-refresh'));
        expect(closeSession).toHaveBeenCalledExactlyOnceWith('user-1', PrincipalType.USER, 'stable-session');
        expect(record).toHaveBeenCalledWith({ action: AuditAction.LOGOUT, targetId: 'user-1' });
    });

    it('treats invalid credentials as an unaudited no-op', async () => {
        verifyLogoutToken.mockRejectedValueOnce(new UnauthenticatedException());
        await handler.execute(new LogoutCommand('invalid'));
        expect(closeSession).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('does not acknowledge logout when session persistence is unavailable', async () => {
        const failure = new DependencyUnavailableException();
        closeSession.mockRejectedValueOnce(failure);
        await expect(handler.execute(new LogoutCommand('valid'))).rejects.toBe(failure);
        expect(record).not.toHaveBeenCalled();
    });
});
