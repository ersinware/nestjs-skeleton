/**
 * @file email-confirmation-token.spec.ts
 * @description Email proof determinism, token isolation, claim validation, and error propagation.
 */

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenAdapter } from 'src/core/security/token/adapter/token.adapter';
import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';
import type { EmailConfirmationTokenPayload } from 'src/core/security/token/email-confirmation-token-payload.type';
import { PrincipalType } from 'src/shared/domain/principal';
import { UnauthenticatedException } from 'src/shared/exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Email confirmation tokens', () => {
    const config = {
        SESSION_ABSOLUTE_TTL_ADMIN: '8h',
        SESSION_ABSOLUTE_TTL_USER: '7d',
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_SECRET: 'r'.repeat(32),
        JWT_REFRESH_TTL: '1d',
        JWT_INVITE_SECRET: 'i'.repeat(32),
        JWT_USER_ACTIVATION_SECRET: 'u'.repeat(32),
        JWT_EMAIL_CONFIRM_SECRET: 'e'.repeat(32),
    };
    const request: Omit<EmailConfirmationTokenPayload, 'type'> = {
        sub: 'account-1',
        principalType: PrincipalType.ADMIN,
        jti: '12345678-1234-4234-8234-123456789abc',
        emailRevocationVersion: 3,
        exp: Math.floor(new Date('2026-09-23T00:30:00Z').getTime() / 1000),
    };
    let jwt: JwtService;
    let adapter: TokenAdapter;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-23T00:00:00Z'));
        jwt = new JwtService();
        adapter = new TokenAdapter(jwt, new ConfigService(config));
    });
    afterEach(() => vi.useRealTimers());

    it.each([PrincipalType.ADMIN, PrincipalType.USER])('round-trips %s with only the intended claims', async (kind) => {
        const claims = { ...request, principalType: kind };
        const token = await adapter.generateEmailConfirmationToken(claims);
        expect(await adapter.verifyEmailConfirmationToken(token)).toEqual({
            ...claims,
            type: AuthTokenType.EMAIL_CONFIRM,
        });
        expect(jwt.decode(token)).not.toHaveProperty('iat');
    });

    it('keeps the same token and deadline despite later delivery and reordered input properties', async () => {
        const first = await adapter.generateEmailConfirmationToken(request);
        vi.setSystemTime(new Date('2026-09-23T00:20:00Z'));
        const retry = await adapter.generateEmailConfirmationToken({
            exp: request.exp,
            emailRevocationVersion: request.emailRevocationVersion,
            jti: request.jti,
            principalType: request.principalType,
            sub: request.sub,
        });
        expect(retry).toBe(first);
        vi.setSystemTime(request.exp * 1000);
        await expect(adapter.verifyEmailConfirmationToken(retry)).rejects.toBeInstanceOf(UnauthenticatedException);
    });

    it('rejects other credentials as email proofs and email proofs as session/invite credentials', async () => {
        const pair = await adapter.generateTokens({ id: request.sub, type: request.principalType, permissions: [] }, 3);
        const invitation = await adapter.generateInviteToken({
            sub: request.sub,
            jti: request.jti,
            exp: request.exp,
            inviteRevocationVersion: 3,
        });
        expect(await adapter.verifyInviteToken(invitation)).toMatchObject({ sub: request.sub });
        for (const token of [pair.accessToken, pair.refreshToken, invitation]) {
            await expect(adapter.verifyEmailConfirmationToken(token)).rejects.toBeInstanceOf(UnauthenticatedException);
        }
        const proof = await adapter.generateEmailConfirmationToken(request);
        await expect(adapter.verifyAccessToken(proof)).rejects.toBeInstanceOf(UnauthenticatedException);
        await expect(adapter.verifyRefreshToken(proof)).rejects.toBeInstanceOf(UnauthenticatedException);
        await expect(adapter.verifyInviteToken(proof)).rejects.toBeInstanceOf(UnauthenticatedException);
    });

    it.each([AuthTokenType.ACCESS, AuthTokenType.REFRESH, AuthTokenType.INVITE, AuthTokenType.USER_ACTIVATION])(
        'rejects the %s discriminator even with the email signing key',
        async (type) => {
            const token = await jwt.signAsync(
                { ...request, type },
                {
                    secret: config.JWT_EMAIL_CONFIRM_SECRET,
                    algorithm: 'HS256',
                    noTimestamp: true,
                },
            );
            await expect(adapter.verifyEmailConfirmationToken(token)).rejects.toBeInstanceOf(UnauthenticatedException);
        },
    );

    it.each(['sub', 'principalType', 'jti', 'emailRevocationVersion', 'exp', 'type'])(
        'rejects a correctly signed proof without %s',
        async (field) => {
            const claims: Record<string, unknown> = { ...request, type: AuthTokenType.EMAIL_CONFIRM };
            delete claims[field];
            const token = await jwt.signAsync(claims, { secret: config.JWT_EMAIL_CONFIRM_SECRET, algorithm: 'HS256' });
            await expect(adapter.verifyEmailConfirmationToken(token)).rejects.toBeInstanceOf(UnauthenticatedException);
        },
    );

    it.each([
        ['sub', ''],
        ['sub', 1],
        ['principalType', 'unknown'],
        ['principalType', null],
        ['jti', 'invalid'],
        ['jti', '12345678-1234-7234-8234-123456789abc'],
        ['jti', 1],
        ['emailRevocationVersion', -1],
        ['emailRevocationVersion', 0.5],
        ['emailRevocationVersion', '3'],
        ['emailRevocationVersion', Number.MAX_SAFE_INTEGER + 1],
        ['exp', 0],
        ['exp', -1],
        ['exp', request.exp + 0.5],
        ['exp', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects malformed %s claim %s', async (field, value) => {
        const token = await jwt.signAsync(
            { ...request, type: AuthTokenType.EMAIL_CONFIRM, [field]: value },
            {
                secret: config.JWT_EMAIL_CONFIRM_SECRET,
                algorithm: 'HS256',
                noTimestamp: true,
            },
        );
        await expect(adapter.verifyEmailConfirmationToken(token)).rejects.toBeInstanceOf(UnauthenticatedException);
    });

    it('accepts zero revocation and rejects future not-before, wrong signatures, and algorithms', async () => {
        const token = await adapter.generateEmailConfirmationToken({ ...request, emailRevocationVersion: 0 });
        expect((await adapter.verifyEmailConfirmationToken(token)).emailRevocationVersion).toBe(0);
        const claims = { ...request, type: AuthTokenType.EMAIL_CONFIRM };
        const wrongKey = await jwt.signAsync(claims, { secret: 'other'.repeat(32), algorithm: 'HS256' });
        const wrongAlgorithm = await jwt.signAsync(claims, {
            secret: config.JWT_EMAIL_CONFIRM_SECRET,
            algorithm: 'HS384',
        });
        const tooEarly = await jwt.signAsync(
            { ...claims, nbf: request.exp - 1 },
            { secret: config.JWT_EMAIL_CONFIRM_SECRET },
        );
        for (const invalid of [wrongKey, wrongAlgorithm, tooEarly, 'not-a-jwt']) {
            await expect(adapter.verifyEmailConfirmationToken(invalid)).rejects.toBeInstanceOf(
                UnauthenticatedException,
            );
        }
    });

    it('propagates unexpected verifier and signer failures unchanged', async () => {
        const failure = new Error('unexpected dependency failure');
        vi.spyOn(jwt, 'verifyAsync').mockRejectedValueOnce(failure);
        await expect(adapter.verifyEmailConfirmationToken('token')).rejects.toBe(failure);
        vi.spyOn(jwt, 'signAsync').mockRejectedValueOnce(failure);
        await expect(adapter.generateEmailConfirmationToken(request)).rejects.toBe(failure);
    });
});
