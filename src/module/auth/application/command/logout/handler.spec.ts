/**
 * @file handler.spec.ts
 * @description Unit tests for the logout command handler.
 */

import { AuditAction, type IAuditPort } from 'src/core/observability/audit';
import { type ISessionPort } from 'src/core/security/session';
import { AuthTokenType, type ITokenPort } from 'src/core/security/token';
import { LogoutCommand } from 'src/module/auth/application/command/logout/command';
import { LogoutCommandHandler } from 'src/module/auth/application/command/logout/handler';
import { PrincipalType, type Principal } from 'src/shared/domain/principal';
import { UnauthenticatedException } from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('LogoutCommandHandler', () => {
    const principal: Principal = {
        id: 'user-1',
        type: PrincipalType.USER,
        permissions: [],
    };
    const refreshToken = 'refresh-token';
    const verifyRefreshToken = vi.fn<ITokenPort['verifyRefreshToken']>();
    const closeSession = vi.fn<ISessionPort['closeSession']>();
    const record = vi.fn<IAuditPort['record']>();
    let handler: LogoutCommandHandler;

    beforeEach(() => {
        handler = new LogoutCommandHandler(
            { verifyRefreshToken } as unknown as ITokenPort,
            { closeSession } as unknown as ISessionPort,
            { record },
        );
    });

    it('closes and audits the authenticated principal’s session', async () => {
        verifyRefreshToken.mockResolvedValue({
            sub: principal.id,
            principalType: principal.type,
            jti: 'session-1',
            sessionVersion: 1,
            type: AuthTokenType.REFRESH,
        });

        await handler.execute(new LogoutCommand(refreshToken, principal));

        expect(closeSession).toHaveBeenCalledWith(principal.id, 'session-1');
        expect(record).toHaveBeenCalledWith({ action: AuditAction.LOGOUT, targetId: principal.id });
    });

    it('rejects a refresh token owned by another principal without closing or auditing it', async () => {
        verifyRefreshToken.mockResolvedValue({
            sub: 'user-2',
            principalType: PrincipalType.USER,
            jti: 'session-2',
            sessionVersion: 1,
            type: AuthTokenType.REFRESH,
        });

        await expect(handler.execute(new LogoutCommand(refreshToken, principal))).rejects.toBeInstanceOf(
            UnauthenticatedException,
        );

        expect(closeSession).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });
});
