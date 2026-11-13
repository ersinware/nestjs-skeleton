/**
 * @file token.adapter.spec.ts
 * @description Signed session identity, absolute expiry, and logout-only expiry exception coverage.
 */

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { AccessTokenPayload } from 'src/core/security/token/access-token-payload.type';
import { TokenAdapter } from 'src/core/security/token/adapter/token.adapter';
import type { RefreshTokenPayload } from 'src/core/security/token/refresh-token-payload.type';
import { PrincipalType } from 'src/shared/domain/principal';
import { UnauthenticatedException } from 'src/shared/exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('TokenAdapter session lifetime', () => {
    const jwt = new JwtService();
    const principal = { id: 'principal-1', type: PrincipalType.USER, permissions: [] };
    const config = {
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'r'.repeat(32),
        JWT_INVITE_SECRET: 'i'.repeat(32),
        JWT_ACTIVATION_SECRET: 'u'.repeat(32),
        JWT_UPLOAD_SECRET: 'p'.repeat(32),
        JWT_EMAIL_CONFIRM_SECRET: 'e'.repeat(32),
    };
    let adapter: TokenAdapter;
    let accessClaims: Omit<AccessTokenPayload, 'type'>;
    let refreshClaims: Omit<RefreshTokenPayload, 'type'>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-13T00:00:00Z'));
        adapter = new TokenAdapter(jwt, new ConfigService(config));
        const now = Math.floor(Date.now() / 1000),
            payload = {
                sub: principal.id,
                principalType: principal.type,
                sid: randomUUID(),
                sessionVersion: 1,
                sessionExpiresAt: now + 7 * 24 * 60 * 60,
            };
        accessClaims = { ...payload, permissions: principal.permissions, exp: now + 15 * 60 };
        refreshClaims = { ...payload, jti: randomUUID(), exp: now + 24 * 60 * 60 };
    });
    afterEach(() => vi.useRealTimers());

    it.each([
        [PrincipalType.ADMIN, 8 * 60 * 60],
        [PrincipalType.USER, 7 * 24 * 60 * 60],
    ] as const)('preserves the supplied absolute lifetime for %s', async (type, seconds) => {
        const now = Math.floor(Date.now() / 1000),
            access = { ...accessClaims, principalType: type, sessionExpiresAt: now + seconds },
            refresh = {
                ...refreshClaims,
                principalType: type,
                sessionExpiresAt: now + seconds,
                exp: Math.min(refreshClaims.exp, now + seconds),
            },
            tokens = await adapter.generateTokens(access, refresh);
        expect(await adapter.verifyAccessToken(tokens.accessToken)).toMatchObject(access);
        expect(await adapter.verifyRefreshToken(tokens.refreshToken)).toMatchObject(refresh);
        vi.setSystemTime((now + 60) * 1000);
        const regenerated = await adapter.generateTokens(access, refresh);
        expect(await adapter.verifyRefreshToken(regenerated.refreshToken)).toMatchObject(refresh);
    });

    it('signs the supplied credential identity and version', async () => {
        const first = await adapter.generateTokens(accessClaims, refreshClaims),
            access = { ...accessClaims, sessionVersion: 2 },
            refresh = { ...refreshClaims, sessionVersion: 2, jti: randomUUID() },
            regenerated = await adapter.generateTokens(access, refresh);
        expect(await adapter.verifyAccessToken(first.accessToken)).toMatchObject(accessClaims);
        expect(await adapter.verifyAccessToken(regenerated.accessToken)).toMatchObject(access);
        expect(await adapter.verifyRefreshToken(regenerated.refreshToken)).toMatchObject(refresh);
    });

    it('preserves supplied expiries and verification rejects credentials at their deadline', async () => {
        const access = { ...accessClaims, exp: accessClaims.sessionExpiresAt },
            refresh = { ...refreshClaims, exp: refreshClaims.sessionExpiresAt };
        vi.setSystemTime((access.sessionExpiresAt - 2) * 1000);
        const last = await adapter.generateTokens(access, refresh);
        expect((await adapter.verifyRefreshToken(last.refreshToken)).exp).toBe(refresh.exp);
        expect((await adapter.verifyAccessToken(last.accessToken)).exp).toBe(access.exp);
        vi.setSystemTime(access.sessionExpiresAt * 1000);
        await expect(adapter.verifyAccessToken(last.accessToken)).rejects.toBeInstanceOf(UnauthenticatedException);
        await expect(adapter.verifyRefreshToken(last.refreshToken)).rejects.toBeInstanceOf(UnauthenticatedException);
    });

    it('accepts expired refresh proof for replay and logout only within the absolute lifetime', async () => {
        const first = await adapter.generateTokens(accessClaims, refreshClaims);
        vi.setSystemTime(refreshClaims.exp * 1000);
        await expect(adapter.verifyRefreshToken(first.refreshToken)).rejects.toBeInstanceOf(UnauthenticatedException);
        expect(await adapter.verifyLogoutToken(first.refreshToken)).toMatchObject({ sid: refreshClaims.sid });
        expect(await adapter.verifyRefreshTokenForReplay(first.refreshToken)).toMatchObject(refreshClaims);
        await expect(adapter.verifyRefreshTokenForReplay(first.accessToken)).rejects.toBeInstanceOf(
            UnauthenticatedException,
        );
        await expect(adapter.verifyLogoutToken(first.accessToken)).rejects.toBeInstanceOf(UnauthenticatedException);
        vi.setSystemTime(refreshClaims.sessionExpiresAt * 1000);
        await expect(adapter.verifyLogoutToken(first.refreshToken)).rejects.toBeInstanceOf(UnauthenticatedException);
        await expect(adapter.verifyRefreshTokenForReplay(first.refreshToken)).rejects.toBeInstanceOf(
            UnauthenticatedException,
        );
    });

    it.each(['sid', 'sessionExpiresAt', 'exp', 'jti', 'sessionVersion'])(
        'rejects signed legacy/malformed refresh without %s',
        async (field) => {
            const first = await adapter.generateTokens(accessClaims, refreshClaims),
                decoded = jwt.decode<Record<string, unknown>>(first.refreshToken);
            delete decoded[field];
            const malformed = await jwt.signAsync(decoded, { secret: config.JWT_REFRESH_SECRET, algorithm: 'HS256' });
            await expect(adapter.verifyRefreshToken(malformed)).rejects.toBeInstanceOf(UnauthenticatedException);
            await expect(adapter.verifyLogoutToken(malformed)).rejects.toBeInstanceOf(UnauthenticatedException);
            await expect(adapter.verifyRefreshTokenForReplay(malformed)).rejects.toBeInstanceOf(
                UnauthenticatedException,
            );
        },
    );
});
