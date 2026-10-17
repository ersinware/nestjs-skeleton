/**
 * @file token.adapter.spec.ts
 * @description Signed session identity, absolute expiry, and logout-only expiry exception coverage.
 */

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenAdapter } from 'src/core/security/token/adapter/token.adapter';
import { PrincipalType } from 'src/shared/domain/principal';
import { UnauthenticatedException } from 'src/shared/exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('TokenAdapter session lifetime', () => {
    const jwt = new JwtService();
    const principal = { id: 'principal-1', type: PrincipalType.USER, permissions: [] };
    const config = {
        SESSION_ABSOLUTE_TTL_ADMIN: '8h',
        SESSION_ABSOLUTE_TTL_USER: '7d',
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_SECRET: 'r'.repeat(32),
        JWT_REFRESH_TTL: '1d',
        JWT_INVITE_SECRET: 'i'.repeat(32),
        JWT_ACTIVATION_SECRET: 'u'.repeat(32),
        JWT_UPLOAD_SECRET: 'p'.repeat(32),
        JWT_EMAIL_CONFIRM_SECRET: 'e'.repeat(32),
    };
    let adapter: TokenAdapter;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-13T00:00:00Z'));
        adapter = new TokenAdapter(jwt, new ConfigService(config));
    });
    afterEach(() => vi.useRealTimers());

    it.each([
        [PrincipalType.ADMIN, 8 * 60 * 60],
        [PrincipalType.USER, 7 * 24 * 60 * 60],
    ] as const)('uses the configured absolute lifetime for %s', async (type, seconds) => {
        const now = Math.floor(Date.now() / 1000),
            tokens = await adapter.generateTokens({ ...principal, type }, 1);
        expect(tokens.session.sessionExpiresAt).toBe(now + seconds);
        expect(await adapter.verifyAccessToken(tokens.accessToken)).toMatchObject({
            principalType: type,
            sessionExpiresAt: now + seconds,
        });
        expect(await adapter.verifyRefreshToken(tokens.refreshToken)).toMatchObject({
            principalType: type,
            sessionExpiresAt: now + seconds,
        });
        vi.setSystemTime((now + 60) * 1000);
        const refreshed = await adapter.refreshTokens({ ...principal, type }, 1, tokens.session);
        expect(refreshed.session.sessionExpiresAt).toBe(now + seconds);
    });

    it('creates distinct logins and preserves identity while rotating only the credential', async () => {
        const first = await adapter.generateTokens(principal, 1),
            second = await adapter.generateTokens(principal, 1),
            refreshed = await adapter.refreshTokens(principal, 2, first.session);
        expect(first.session.sid).not.toBe(second.session.sid);
        expect(first.session.sessionVersion).toBe(1);
        expect(refreshed.session.sessionVersion).toBe(2);
        expect(refreshed.session.sid).toBe(first.session.sid);
        expect(refreshed.session.sessionExpiresAt).toBe(first.session.sessionExpiresAt);
        expect(refreshed.session.refreshTokenJti).not.toBe(first.session.refreshTokenJti);
        expect(await adapter.verifyAccessToken(refreshed.accessToken)).toMatchObject({
            sid: first.session.sid,
            sessionVersion: 2,
            sessionExpiresAt: first.session.sessionExpiresAt,
        });
        expect(await adapter.verifyRefreshToken(refreshed.refreshToken)).toMatchObject({ sid: first.session.sid });
    });

    it('caps both credentials at the original absolute deadline and rejects renewal at that boundary', async () => {
        const first = await adapter.generateTokens(principal, 1);
        vi.setSystemTime((first.session.sessionExpiresAt - 2) * 1000);
        const last = await adapter.refreshTokens(principal, 1, first.session);
        expect(last.session.refreshExpiresAt).toBe(first.session.sessionExpiresAt);
        expect((await adapter.verifyAccessToken(last.accessToken)).exp).toBe(first.session.sessionExpiresAt);
        vi.setSystemTime(first.session.sessionExpiresAt * 1000);
        await expect(adapter.verifyAccessToken(last.accessToken)).rejects.toBeInstanceOf(UnauthenticatedException);
        await expect(adapter.verifyRefreshToken(last.refreshToken)).rejects.toBeInstanceOf(UnauthenticatedException);
        await expect(adapter.refreshTokens(principal, 1, first.session)).rejects.toBeInstanceOf(
            UnauthenticatedException,
        );
    });

    it('accepts expired refresh proof only for logout within the absolute lifetime', async () => {
        const first = await adapter.generateTokens(principal, 1);
        vi.setSystemTime(first.session.refreshExpiresAt * 1000);
        await expect(adapter.verifyRefreshToken(first.refreshToken)).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(await adapter.verifyLogoutToken(first.refreshToken)).toMatchObject({ sid: first.session.sid });
        await expect(adapter.verifyLogoutToken(first.accessToken)).rejects.toBeInstanceOf(UnauthenticatedException);
        vi.setSystemTime(first.session.sessionExpiresAt * 1000);
        await expect(adapter.verifyLogoutToken(first.refreshToken)).rejects.toBeInstanceOf(UnauthenticatedException);
    });

    it.each(['sid', 'sessionExpiresAt', 'exp', 'jti', 'sessionVersion'])(
        'rejects signed legacy/malformed refresh without %s',
        async (field) => {
            const first = await adapter.generateTokens(principal, 1),
                claims = jwt.decode<Record<string, unknown>>(first.refreshToken);
            delete claims[field];
            const malformed = await jwt.signAsync(claims, { secret: config.JWT_REFRESH_SECRET, algorithm: 'HS256' });
            await expect(adapter.verifyRefreshToken(malformed)).rejects.toBeInstanceOf(UnauthenticatedException);
            await expect(adapter.verifyLogoutToken(malformed)).rejects.toBeInstanceOf(UnauthenticatedException);
        },
    );
});
