/**
 * @file handler.spec.ts
 * @description Logout proof, stable identity, idempotency, and required session persistence.
 */

import { REFRESH_TOKEN_TYPE, type RefreshTokenPayload } from 'src/core/security/auth';
import type { ISessionPort } from 'src/core/security/session';
import type { ITokenPort, TokenVerifyOptions } from 'src/core/security/token';
import { LogoutCommand } from 'src/module/auth/application/command/logout/command';
import { LogoutCommandHandler } from 'src/module/auth/application/command/logout/handler';
import { PrincipalType } from 'src/shared/domain/principal';
import { DependencyUnavailableException, UnauthenticatedException } from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('LogoutCommandHandler', () => {
    const verify =
        vi.fn<
            (
                token: string,
                expectedType: typeof REFRESH_TOKEN_TYPE,
                options?: TokenVerifyOptions,
            ) => Promise<RefreshTokenPayload>
        >();
    const closeSession = vi.fn<ISessionPort['closeSession']>();
    let handler: LogoutCommandHandler;

    beforeEach(() => {
        verify.mockResolvedValue({
            sub: 'user-1',
            principalType: PrincipalType.USER,
            sid: 'stable-session',
            jti: 'old-credential',
            sessionVersion: 1,
            exp: 1,
            sessionExpiresAt: 2000000000,
            type: REFRESH_TOKEN_TYPE,
        });
        closeSession.mockResolvedValue(undefined);
        handler = new LogoutCommandHandler(
            { verify } as unknown as ITokenPort<typeof REFRESH_TOKEN_TYPE>,
            { closeSession } as unknown as ISessionPort,
        );
    });

    it('closes the signed stable session without access credentials or a current refresh jti', async () => {
        await handler.execute(new LogoutCommand('old-refresh'));
        expect(verify).toHaveBeenCalledExactlyOnceWith('old-refresh', REFRESH_TOKEN_TYPE, {
            ignoreExpiration: true,
        });
        expect(closeSession).toHaveBeenCalledExactlyOnceWith('user-1', PrincipalType.USER, 'stable-session');
    });

    it('treats invalid credentials as a no-op', async () => {
        verify.mockRejectedValueOnce(new UnauthenticatedException());
        await handler.execute(new LogoutCommand('invalid'));
        expect(closeSession).not.toHaveBeenCalled();
    });

    it.each([0, 1])('does not close sessions at or after absolute expiry: %s seconds', async (elapsed) => {
        vi.spyOn(Date, 'now').mockReturnValue((2000000000 + elapsed) * 1000);
        await handler.execute(new LogoutCommand('expired-session'));
        expect(closeSession).not.toHaveBeenCalled();
    });

    it('propagates unexpected verification failures without touching sessions', async () => {
        const failure = new Error('verification failed');
        verify.mockRejectedValueOnce(failure);
        await expect(handler.execute(new LogoutCommand('refresh'))).rejects.toBe(failure);
        expect(closeSession).not.toHaveBeenCalled();
    });

    it('does not acknowledge logout when session persistence is unavailable', async () => {
        const failure = new DependencyUnavailableException();
        closeSession.mockRejectedValueOnce(failure);
        await expect(handler.execute(new LogoutCommand('valid'))).rejects.toBe(failure);
    });
});
