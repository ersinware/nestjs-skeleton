/**
 * @file login.util.spec.ts
 * @description Verifies credential preparation, replay issuance, and refusal effects for both login owners.
 */

import type { IdempotencyRequest } from 'src/core/idempotency';
import type { IAuditPort } from 'src/core/observability/audit';
import type { IHashingPort } from 'src/core/security/hashing';
import { OpenSessionOutcome, ReplaySessionOutcome, SessionOutcome, type ISessionPort } from 'src/core/security/session';
import type { ITokenPort } from 'src/core/security/token';
import { login } from 'src/module/auth/application/command/login.util';
import type { IIdentityReaderPort } from 'src/module/auth/application/command/port/identity-reader.port';
import { AuthAuditAction } from 'src/module/auth/shared/auth-audit';
import { PrincipalType } from 'src/shared/domain/principal';
import { ResourceConflictException, UnauthenticatedException } from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe.each(Object.values(PrincipalType))('%s credential login', (principalType) => {
    const identity = {
            id: 'owner',
            password: 'hash',
            isBanned: false,
            requiresActivation: false,
            permissions: [],
            sessionVersion: 2,
        },
        session = {
            principalType,
            sessionVersion: 1,
            sid: 'original-sid',
            refreshTokenJti: 'original-jti',
            sessionExpiresAt: 2_000_000_000,
            refreshExpiresAt: 1_900_000_000,
        },
        request: IdempotencyRequest = { key: 'request', canonicalValue: 'login' },
        getCredentialsByEmail = vi.fn<IIdentityReaderPort['getCredentialsByEmail']>(),
        getRefreshState = vi.fn<IIdentityReaderPort['getRefreshState']>(),
        verifyPassword = vi.fn<IHashingPort['verifyPassword']>(),
        simulatePasswordVerify = vi.fn<IHashingPort['simulatePasswordVerify']>(),
        findSessionRequestReplay = vi.fn<ISessionPort['findSessionRequestReplay']>(),
        openSession = vi.fn<ISessionPort['openSession']>(),
        generateTokens = vi.fn<ITokenPort['generateTokens']>(),
        record = vi.fn<IAuditPort['record']>(),
        ports = {
            identityReaderPort: { getCredentialsByEmail, getRefreshState },
            hashingPort: { verifyPassword, simulatePasswordVerify } as unknown as IHashingPort,
            sessionPort: { findSessionRequestReplay, openSession } as unknown as ISessionPort,
            tokenPort: { generateTokens } as unknown as ITokenPort,
            auditPort: { record },
        },
        execute = () => login(ports, principalType, request, 'owner@example.test', 'password');

    beforeEach(() => {
        getCredentialsByEmail.mockResolvedValue(identity);
        verifyPassword.mockResolvedValue(true);
        findSessionRequestReplay.mockResolvedValue({ outcome: ReplaySessionOutcome.NOT_FOUND, session: null });
        openSession.mockResolvedValue({ outcome: OpenSessionOutcome.OPENED, session, accessExpiresAt: 1_800_000_000 });
        generateTokens.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
    });

    it('opens only after password proof and audits only the first admitted mutation', async () => {
        expect(await execute()).toEqual({
            session: SessionOutcome.CREATED,
            accessToken: 'access',
            refreshToken: 'refresh',
        });
        expect(openSession).toHaveBeenCalledExactlyOnceWith(
            request,
            identity.id,
            principalType,
            identity.sessionVersion,
        );
        expect(verifyPassword.mock.invocationCallOrder[0]).toBeLessThan(openSession.mock.invocationCallOrder[0]!);
        expect(record).toHaveBeenCalledExactlyOnceWith({
            action: AuthAuditAction.LOGIN_SUCCESS,
            targetId: identity.id,
        });
    });

    it.each(['pre-read', 'mutation'] as const)(
        'reissues the original registration on %s replay without duplicate session or success audit',
        async (boundary) => {
            if (boundary === 'pre-read') {
                findSessionRequestReplay.mockResolvedValueOnce({
                    outcome: ReplaySessionOutcome.REPLAYED,
                    session,
                    accessExpiresAt: 1_800_000_000,
                });
            } else {
                openSession.mockResolvedValueOnce({
                    outcome: ReplaySessionOutcome.REPLAYED,
                    session,
                    accessExpiresAt: 1_800_000_000,
                });
            }
            await execute();
            if (boundary === 'pre-read') {
                expect(verifyPassword).not.toHaveBeenCalled();
                expect(openSession).not.toHaveBeenCalled();
            }
            expect(record).not.toHaveBeenCalled();
            expect(getRefreshState).not.toHaveBeenCalled();
            expect(generateTokens).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    sid: session.sid,
                    sessionVersion: 1,
                    sessionExpiresAt: session.sessionExpiresAt,
                    exp: 1_800_000_000,
                }),
                expect.objectContaining({
                    sid: session.sid,
                    jti: session.refreshTokenJti,
                    sessionVersion: 1,
                    exp: session.refreshExpiresAt,
                }),
            );
        },
    );

    it.each([
        ReplaySessionOutcome.CONFLICT,
        ReplaySessionOutcome.REPLAY_UNAVAILABLE,
        ReplaySessionOutcome.SESSION_UNAVAILABLE,
        ReplaySessionOutcome.VERSION_SUPERSEDED,
    ] as const)('refuses %s before preparation without login evidence or tokens', async (outcome) => {
        findSessionRequestReplay.mockResolvedValueOnce({ outcome, session: null });
        await expect(execute()).rejects.toBeInstanceOf(
            outcome === ReplaySessionOutcome.CONFLICT ? ResourceConflictException : UnauthenticatedException,
        );
        expect(verifyPassword).not.toHaveBeenCalled();
        expect(openSession).not.toHaveBeenCalled();
        expect(generateTokens).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('does not query replay again after invalid password preparation', async () => {
        verifyPassword.mockResolvedValueOnce(false);
        await expect(execute()).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(findSessionRequestReplay).toHaveBeenCalledTimes(1);
        expect(openSession).not.toHaveBeenCalled();
        expect(generateTokens).not.toHaveBeenCalled();
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: AuthAuditAction.LOGIN_FAILED }));
    });

    it('preserves pending-user activation without retaining session success', async () => {
        getCredentialsByEmail.mockResolvedValueOnce({ ...identity, requiresActivation: true });
        expect(await execute()).toEqual({ session: SessionOutcome.ACTIVATION_REQUIRED });
        expect(findSessionRequestReplay).toHaveBeenCalledTimes(1);
        expect(openSession).not.toHaveBeenCalled();
        expect(generateTokens).not.toHaveBeenCalled();
    });
});
