/**
 * @file auth-guards.spec.ts
 * @description Request-time identity, session, permission, and failure-effect coverage for global guards.
 */

import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import 'reflect-metadata';
import * as audit from 'src/core/observability/audit';
import { Authenticated } from 'src/core/security/auth/decorator/authenticated.decorator';
import { Permissions } from 'src/core/security/auth/decorator/permissions.decorator';
import { PrincipalOnly } from 'src/core/security/auth/decorator/principal-only.decorator';
import { Public } from 'src/core/security/auth/decorator/public.decorator';
import { AuthenticationGuard } from 'src/core/security/auth/guard/authentication.guard';
import { AuthorizationGuard } from 'src/core/security/auth/guard/authorization.guard';
import type { ISessionPort } from 'src/core/security/session';
import { AuthTokenType, type AccessTokenPayload, type ITokenPort } from 'src/core/security/token';
import { Permission, PrincipalType } from 'src/shared/domain/principal';
import { AccessDeniedException, DependencyUnavailableException, UnauthenticatedException } from 'src/shared/exception';
import { describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';

type GuardFixture = {
    readonly payload: AccessTokenPayload;
    readonly request: {
        headers: Readonly<Record<string, string>>;
        accessTokenPayload?: AccessTokenPayload;
    };
    readonly tokens: { readonly [K in keyof ITokenPort]: Mock<ITokenPort[K]> };
    readonly sessions: { readonly [K in keyof ISessionPort]: Mock<ISessionPort[K]> };
    readonly context: ExecutionContextHost;
    readonly authentication: AuthenticationGuard;
    readonly authorization: AuthorizationGuard;
    readonly publishActor: MockInstance<typeof audit.publishAuditActor>;
};

/**
 * Builds an isolated request with real endpoint metadata and mocked external ports.
 * @param policies Method policies.
 * @param classPolicies Controller policies.
 * @returns Guards, request, context, and external dependency mocks.
 */
function fixture(
    policies: readonly (ClassDecorator & MethodDecorator)[] = [Authenticated()],
    classPolicies: readonly (ClassDecorator & MethodDecorator)[] = [],
): GuardFixture {
    class ControllerFixture {
        /**
         * Protected endpoint.
         */
        endpoint(this: void) {}
    }
    for (const policy of classPolicies) policy(ControllerFixture);
    for (const policy of policies)
        policy(
            ControllerFixture.prototype,
            'endpoint',
            Object.getOwnPropertyDescriptor(ControllerFixture.prototype, 'endpoint')!,
        );
    const payload: AccessTokenPayload = {
        sub: 'principal-1',
        sid: 'session-1',
        sessionExpiresAt: 2000000000,
        exp: 2000000000,
        principalType: PrincipalType.ADMIN,
        permissions: [],
        sessionVersion: 3,
        type: AuthTokenType.ACCESS,
    };
    const request: {
        headers: Readonly<Record<string, string>>;
        accessTokenPayload?: AccessTokenPayload;
    } = {
        headers: { authorization: 'Bearer signed-token' },
    };
    const tokens = {
        verifyAccessToken: vi.fn<ITokenPort['verifyAccessToken']>().mockResolvedValue(payload),
        verifyRefreshToken: vi.fn(),
        verifyLogoutToken: vi.fn(),
        generateTokens: vi.fn(),
        refreshTokens: vi.fn(),
        generateInviteToken: vi.fn(),
        verifyInviteToken: vi.fn(),
        generateEmailConfirmationToken: vi.fn(),
        verifyEmailConfirmationToken: vi.fn(),
    } satisfies ITokenPort;
    const sessions = {
        getVersion: vi.fn<ISessionPort['getVersion']>().mockResolvedValue(3),
        isSessionActive: vi.fn<ISessionPort['isSessionActive']>().mockResolvedValue(true),
        openSession: vi.fn(),
        rotateSession: vi.fn(),
        closeSession: vi.fn(),
        setVersion: vi.fn(),
    } satisfies ISessionPort;
    return {
        payload,
        request,
        tokens,
        sessions,
        publishActor: vi.spyOn(audit, 'publishAuditActor').mockImplementation(() => {}),
        context: new ExecutionContextHost([request], ControllerFixture, ControllerFixture.prototype.endpoint),
        authentication: new AuthenticationGuard(tokens, sessions, new Reflector()),
        authorization: new AuthorizationGuard(new Reflector()),
    };
}

describe('AuthenticationGuard', () => {
    it('allows public requests without credentials or external calls', async () => {
        const f = fixture([Public()]);
        f.request.headers = {};
        expect(await f.authentication.canActivate(f.context)).toBe(true);
        expect(f.tokens.verifyAccessToken).not.toHaveBeenCalled();
        expect(f.sessions.isSessionActive).not.toHaveBeenCalled();
        expect(f.request.accessTokenPayload).toBeUndefined();
        expect(f.publishActor).not.toHaveBeenCalled();
    });

    it.each([undefined, '', 'Basic token', 'bearer token', 'Bearer', 'Bearer '])(
        'rejects missing or malformed credentials: %s',
        async (header) => {
            const f = fixture();
            f.request.headers = header === undefined ? {} : { authorization: header };
            await expect(f.authentication.canActivate(f.context)).rejects.toBeInstanceOf(UnauthenticatedException);
            expect(f.tokens.verifyAccessToken).not.toHaveBeenCalled();
            expect(f.sessions.isSessionActive).not.toHaveBeenCalled();
        },
    );

    it('propagates token refusal without consulting sessions or publishing identity', async () => {
        const f = fixture(),
            failure = new UnauthenticatedException();
        f.tokens.verifyAccessToken.mockRejectedValue(failure);
        await expect(f.authentication.canActivate(f.context)).rejects.toBe(failure);
        expect(f.sessions.isSessionActive).not.toHaveBeenCalled();
        expect(f.request.accessTokenPayload).toBeUndefined();
        expect(f.publishActor).not.toHaveBeenCalled();
    });

    it('rejects a closed, missing, expired, or retired session', async () => {
        const f = fixture();
        f.sessions.isSessionActive.mockResolvedValue(false);
        await expect(f.authentication.canActivate(f.context)).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(f.publishActor).not.toHaveBeenCalled();
        expect(f.request.accessTokenPayload).toBeUndefined();
        expect(f.publishActor).not.toHaveBeenCalled();
    });

    it.each([new DependencyUnavailableException(), new Error('unexpected Redis failure')])(
        'propagates session failures unchanged',
        async (failure) => {
            const f = fixture();
            f.sessions.isSessionActive.mockRejectedValue(failure);
            await expect(f.authentication.canActivate(f.context)).rejects.toBe(failure);
            expect(f.request.accessTokenPayload).toBeUndefined();
            expect(f.publishActor).not.toHaveBeenCalled();
        },
    );

    it('attaches verified identity only after session admission', async () => {
        const f = fixture();
        f.sessions.isSessionActive.mockResolvedValue(true);
        expect(await f.authentication.canActivate(f.context)).toBe(true);
        expect(f.publishActor).toHaveBeenCalledExactlyOnceWith(f.payload.sub, f.payload.principalType);
        expect(f.tokens.verifyAccessToken).toHaveBeenCalledExactlyOnceWith('signed-token');
        expect(f.sessions.isSessionActive).toHaveBeenCalledExactlyOnceWith(
            f.payload.sub,
            f.payload.principalType,
            f.payload.sid,
            f.payload.sessionVersion,
        );
        expect(f.request.accessTokenPayload).toBe(f.payload);
    });
});

describe('AuthorizationGuard', () => {
    it('admits public without a principal', () => {
        const f = fixture([Public()]);
        expect(f.authorization.canActivate(f.context)).toBe(true);
    });

    it.each([Authenticated(), PrincipalOnly(PrincipalType.ADMIN), Permissions(Permission.ADMIN_ACCOUNT_READ)])(
        'rejects non-public requests without verified identity',
        (policy) => {
            const f = fixture([policy]);
            expect(() => f.authorization.canActivate(f.context)).toThrow(AccessDeniedException);
        },
    );

    it.each([PrincipalType.USER, PrincipalType.ADMIN])(
        'admits authenticated %s without special permissions',
        (kind) => {
            const f = fixture();
            f.request.accessTokenPayload = { ...f.payload, principalType: kind };
            expect(f.authorization.canActivate(f.context)).toBe(true);
        },
    );

    it.each([PrincipalType.USER, PrincipalType.ADMIN])('enforces principal restriction %s', (kind) => {
        const f = fixture([PrincipalOnly(kind)]);
        f.request.accessTokenPayload = { ...f.payload, principalType: kind };
        expect(f.authorization.canActivate(f.context)).toBe(true);
        f.request.accessTokenPayload = {
            ...f.payload,
            principalType: kind === PrincipalType.USER ? PrincipalType.ADMIN : PrincipalType.USER,
        };
        expect(() => f.authorization.canActivate(f.context)).toThrow(AccessDeniedException);
    });

    it.each(
        [[], [Permission.ADMIN_ACCOUNT_READ], [Permission.ADMIN_ACCOUNT_BAN], [Permission.ADMIN_ROOT]].map(
            (permissions) => ({ permissions }),
        ),
    )(
        'rejects incomplete permissions $permissions, including root without operation permissions',
        ({ permissions }) => {
            const f = fixture(
                [Permissions(Permission.ADMIN_ACCOUNT_BAN)],
                [Permissions(Permission.ADMIN_ACCOUNT_READ)],
            );
            f.request.accessTokenPayload = { ...f.payload, permissions };
            expect(() => f.authorization.canActivate(f.context)).toThrow(AccessDeniedException);
        },
    );

    it('accepts all required permissions plus extras', () => {
        const f = fixture([Permissions(Permission.ADMIN_ACCOUNT_BAN)], [Permissions(Permission.ADMIN_ACCOUNT_READ)]);
        f.request.accessTokenPayload = {
            ...f.payload,
            permissions: [Permission.ADMIN_ACCOUNT_READ, Permission.ADMIN_ACCOUNT_BAN, Permission.ADMIN_ROOT],
        };
        expect(f.authorization.canActivate(f.context)).toBe(true);
    });

    it('requires both principal kind and permissions', () => {
        const f = fixture([Permissions(Permission.ADMIN_ACCOUNT_READ)], [PrincipalOnly(PrincipalType.ADMIN)]);
        f.request.accessTokenPayload = { ...f.payload, permissions: [Permission.ADMIN_ACCOUNT_READ] };
        expect(f.authorization.canActivate(f.context)).toBe(true);
        f.request.accessTokenPayload = {
            ...f.payload,
            principalType: PrincipalType.USER,
            permissions: [Permission.ADMIN_ACCOUNT_READ],
        };
        expect(() => f.authorization.canActivate(f.context)).toThrow(AccessDeniedException);
    });
});
