/**
 * @file activation-token.spec.ts
 * @description Verifies activation JWT determinism, type isolation, and claim validation.
 */

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { ActivationTokenPayload } from 'src/core/security/token/activation-token-payload.type';
import { TokenAdapter } from 'src/core/security/token/adapter/token.adapter';
import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';
import { PrincipalType } from 'src/shared/domain/principal';
import { UnauthenticatedException } from 'src/shared/exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Activation tokens', () => {
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
    const request: Omit<ActivationTokenPayload, 'type'> = {
        sub: '01960000-0000-7000-8000-000000000011',
        jti: '12345678-1234-4234-8234-123456789abc',
        activationRevocationVersion: 0,
        exp: Math.floor(new Date('2026-09-27T00:00:00Z').getTime() / 1000),
    };
    let jwt: JwtService;
    let adapter: TokenAdapter;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-24T00:00:00Z'));
        jwt = new JwtService();
        adapter = new TokenAdapter(jwt, new ConfigService(config));
    });
    afterEach(() => vi.useRealTimers());

    it('reproduces the exact token after a resend without extending the persisted deadline', async () => {
        const first = await adapter.generateActivationToken(request);
        vi.setSystemTime(new Date('2026-09-26T00:00:00Z'));
        const resent = await adapter.generateActivationToken({
            exp: request.exp,
            activationRevocationVersion: request.activationRevocationVersion,
            jti: request.jti,
            sub: request.sub,
        });
        expect(resent).toBe(first);
        expect(await adapter.verifyActivationToken(resent)).toEqual({
            ...request,
            type: AuthTokenType.ACTIVATION,
        });
        expect(jwt.decode(resent)).not.toHaveProperty('iat');
        vi.setSystemTime(request.exp * 1000);
        await expect(adapter.verifyActivationToken(resent)).rejects.toBeInstanceOf(UnauthenticatedException);
    });

    it('rejects session, invitation, and email proofs as activation credentials', async () => {
        const pair = await adapter.generateTokens({ id: request.sub, type: PrincipalType.USER, permissions: [] }, 0);
        const invitation = await adapter.generateInviteToken({
            sub: request.sub,
            jti: request.jti,
            exp: request.exp,
            inviteRevocationVersion: 0,
        });
        const emailProof = await adapter.generateEmailConfirmationToken({
            sub: request.sub,
            principalType: PrincipalType.USER,
            jti: request.jti,
            exp: request.exp,
            emailRevocationVersion: 0,
        });
        for (const token of [pair.accessToken, pair.refreshToken, invitation, emailProof]) {
            await expect(adapter.verifyActivationToken(token)).rejects.toBeInstanceOf(UnauthenticatedException);
        }
        const proof = await adapter.generateActivationToken(request);
        await expect(adapter.verifyAccessToken(proof)).rejects.toBeInstanceOf(UnauthenticatedException);
        await expect(adapter.verifyRefreshToken(proof)).rejects.toBeInstanceOf(UnauthenticatedException);
        await expect(adapter.verifyInviteToken(proof)).rejects.toBeInstanceOf(UnauthenticatedException);
    });

    it.each(['sub', 'jti', 'exp', 'activationRevocationVersion', 'type'])(
        'rejects correctly signed proof missing %s',
        async (field) => {
            const claims: Record<string, unknown> = { ...request, type: AuthTokenType.ACTIVATION };
            delete claims[field];
            const token = await jwt.signAsync(claims, {
                secret: config.JWT_ACTIVATION_SECRET,
                algorithm: 'HS256',
            });
            await expect(adapter.verifyActivationToken(token)).rejects.toBeInstanceOf(UnauthenticatedException);
        },
    );

    it.each([
        ['sub', ''],
        ['jti', 'invalid'],
        ['jti', '12345678-1234-7234-8234-123456789abc'],
        ['activationRevocationVersion', -1],
        ['activationRevocationVersion', 0.5],
        ['exp', 0],
        ['exp', request.exp + 0.5],
    ])('rejects malformed %s claim %s', async (field, value) => {
        const token = await jwt.signAsync(
            { ...request, type: AuthTokenType.ACTIVATION, [field]: value },
            { secret: config.JWT_ACTIVATION_SECRET, algorithm: 'HS256', noTimestamp: true },
        );
        await expect(adapter.verifyActivationToken(token)).rejects.toBeInstanceOf(UnauthenticatedException);
    });

    it('rejects wrong key, algorithm, and future not-before', async () => {
        const claims = { ...request, type: AuthTokenType.ACTIVATION };
        const wrongKey = await jwt.signAsync(claims, { secret: 'other'.repeat(32), algorithm: 'HS256' });
        const wrongAlgorithm = await jwt.signAsync(claims, {
            secret: config.JWT_ACTIVATION_SECRET,
            algorithm: 'HS384',
        });
        const tooEarly = await jwt.signAsync(
            { ...claims, nbf: request.exp - 1 },
            { secret: config.JWT_ACTIVATION_SECRET, algorithm: 'HS256' },
        );
        for (const invalid of [wrongKey, wrongAlgorithm, tooEarly]) {
            await expect(adapter.verifyActivationToken(invalid)).rejects.toBeInstanceOf(UnauthenticatedException);
        }
    });
});
