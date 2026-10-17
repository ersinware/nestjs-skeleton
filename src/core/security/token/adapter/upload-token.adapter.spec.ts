/**
 * @file upload-token.adapter.spec.ts
 * @description Upload token signing, workflow isolation, expiry, and claim validation.
 */

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenAdapter } from 'src/core/security/token/adapter/token.adapter';
import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';
import type { UploadTokenPayload } from 'src/core/security/token/upload-token-payload.type';
import { PrincipalType } from 'src/shared/domain/principal';
import { UnauthenticatedException } from 'src/shared/exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('TokenAdapter upload tokens', () => {
    const now = Math.floor(new Date('2026-09-30T12:00:00Z').getTime() / 1000);
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
    const userClaims: Omit<UploadTokenPayload, 'type'> = {
        sub: 'subject-1',
        jti: '12345678-1234-4234-8234-123456789abc',
        purpose: 'documents_upload',
        fileKey: 'pending/documents/subject-1',
        formHash: 'domain-owned-binding',
        exp: now + 600,
    };
    let jwt: JwtService;
    let adapter: TokenAdapter;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(now * 1000);
        jwt = new JwtService();
        const configService = new ConfigService(config);
        adapter = new TokenAdapter(jwt, configService);
    });

    afterEach(() => vi.useRealTimers());

    it('signs only the supplied upload claims and preserves the caller expiry', async () => {
        const input = { ...userClaims, password: 'excluded', sizeBytes: 123, type: AuthTokenType.ACCESS };
        const token = await adapter.generateUploadToken(input);
        const expected = { ...userClaims, type: AuthTokenType.UPLOAD };
        expect(jwt.decode(token)).toEqual(expected);
        await expect(adapter.verifyUploadToken(token, userClaims.purpose)).resolves.toEqual(expected);
        await expect(adapter.verifyUploadToken(token, 'other_workflow')).rejects.toBeInstanceOf(
            UnauthenticatedException,
        );
    });

    it('rejects the proof at its caller-supplied deadline', async () => {
        const token = await adapter.generateUploadToken(userClaims);
        vi.setSystemTime(userClaims.exp * 1000);
        await expect(adapter.verifyUploadToken(token, userClaims.purpose)).rejects.toBeInstanceOf(
            UnauthenticatedException,
        );
    });

    it('rejects changed subject, key, purpose, signature, algorithm, and future not-before', async () => {
        const token = await adapter.generateUploadToken(userClaims);
        const [header, , signature] = token.split('.');
        const original = jwt.decode<Record<string, unknown>>(token);

        for (const change of [
            { sub: 'another-account' },
            { fileKey: 'pending/avatar/user/another-account' },
            { purpose: 'other_workflow' },
        ]) {
            const changedPayload = Buffer.from(JSON.stringify({ ...original, ...change })).toString('base64url');
            await expect(
                adapter.verifyUploadToken(`${header}.${changedPayload}.${signature}`, userClaims.purpose),
            ).rejects.toBeInstanceOf(UnauthenticatedException);
        }

        const wrongSignature = await jwt.signAsync(original, {
            secret: 'wrong'.repeat(32),
            algorithm: 'HS256',
            noTimestamp: true,
        });
        const wrongAlgorithm = await jwt.signAsync(original, {
            secret: config.JWT_UPLOAD_SECRET,
            algorithm: 'HS384',
            noTimestamp: true,
        });
        const tooEarly = await jwt.signAsync(
            { ...original, nbf: now + 1 },
            { secret: config.JWT_UPLOAD_SECRET, algorithm: 'HS256', noTimestamp: true },
        );

        for (const invalid of [wrongSignature, wrongAlgorithm, tooEarly, 'not-a-jwt']) {
            await expect(adapter.verifyUploadToken(invalid, userClaims.purpose)).rejects.toBeInstanceOf(
                UnauthenticatedException,
            );
        }
    });

    it('rejects other credential types even when signed with the upload key', async () => {
        for (const type of [
            AuthTokenType.ACCESS,
            AuthTokenType.REFRESH,
            AuthTokenType.INVITE,
            AuthTokenType.ACTIVATION,
            AuthTokenType.EMAIL_CONFIRM,
        ]) {
            const token = await jwt.signAsync(
                { ...userClaims, exp: now + 1800, type },
                { secret: config.JWT_UPLOAD_SECRET, algorithm: 'HS256', noTimestamp: true },
            );
            await expect(adapter.verifyUploadToken(token, userClaims.purpose)).rejects.toBeInstanceOf(
                UnauthenticatedException,
            );
        }
    });

    it('isolates upload proofs from every existing token verifier', async () => {
        const pair = await adapter.generateTokens({ id: userClaims.sub, type: PrincipalType.USER, permissions: [] }, 0);
        await expect(adapter.verifyUploadToken(pair.accessToken, userClaims.purpose)).rejects.toBeInstanceOf(
            UnauthenticatedException,
        );

        const uploadProof = await adapter.generateUploadToken(userClaims);
        for (const verify of [
            adapter.verifyAccessToken.bind(adapter),
            adapter.verifyRefreshToken.bind(adapter),
            adapter.verifyLogoutToken.bind(adapter),
            adapter.verifyInviteToken.bind(adapter),
            adapter.verifyActivationToken.bind(adapter),
            adapter.verifyEmailConfirmationToken.bind(adapter),
        ]) {
            await expect(verify(uploadProof)).rejects.toBeInstanceOf(UnauthenticatedException);
        }
    });

    it.each([
        ['sub', ''],
        ['sub', null],
        ['jti', 'invalid'],
        ['jti', null],
        ['purpose', ''],
        ['purpose', null],
        ['fileKey', ''],
        ['fileKey', null],
        ['formHash', ''],
        ['formHash', null],
        ['exp', undefined],
        ['exp', 0],
        ['exp', now + 0.5],
    ])('rejects malformed signed %s claims (%s)', async (field, value) => {
        const claims: Record<string, unknown> = { ...userClaims, type: AuthTokenType.UPLOAD, [field]: value };
        if (value === undefined) {
            delete claims[field];
        }
        const token = await jwt.signAsync(claims, {
            secret: config.JWT_UPLOAD_SECRET,
            algorithm: 'HS256',
            noTimestamp: true,
        });
        await expect(adapter.verifyUploadToken(token, userClaims.purpose)).rejects.toBeInstanceOf(
            UnauthenticatedException,
        );
    });

    it('propagates unexpected signer and verifier failures unchanged', async () => {
        const failure = new Error('unexpected dependency failure');
        vi.spyOn(jwt, 'signAsync').mockRejectedValueOnce(failure);
        await expect(adapter.generateUploadToken(userClaims)).rejects.toBe(failure);
        vi.spyOn(jwt, 'verifyAsync').mockRejectedValueOnce(failure);
        await expect(adapter.verifyUploadToken('token', userClaims.purpose)).rejects.toBe(failure);
    });
});

describe('Upload revocation snapshots', () => {
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
    const claims = {
        sub: 'owner',
        jti: '12345678-1234-4234-8234-123456789abc',
        purpose: 'profile',
        fileKey: 'pending/profile',
        formHash: 'binding',
        exp: Math.floor(Date.now() / 1000) + 600,
        type: AuthTokenType.UPLOAD,
    };

    it('requires a snapshot only when requested and preserves zero', async () => {
        const adapter = new TokenAdapter(new JwtService(), new ConfigService(config));
        const without = await adapter.generateUploadToken(claims);
        await expect(adapter.verifyUploadToken(without, claims.purpose)).resolves.not.toHaveProperty(
            'revocationVersion',
        );
        await expect(adapter.verifyUploadToken(without, claims.purpose, true)).rejects.toBeInstanceOf(
            UnauthenticatedException,
        );
        const withVersion = await adapter.generateUploadToken({ ...claims, revocationVersion: 0 });
        await expect(adapter.verifyUploadToken(withVersion, claims.purpose, true)).resolves.toMatchObject({
            revocationVersion: 0,
        });
    });

    it.each([null, -1, 0.5, '0', Number.MAX_SAFE_INTEGER + 1])(
        'rejects malformed signed snapshot %s with either verification mode',
        async (revocationVersion) => {
            const jwt = new JwtService();
            const adapter = new TokenAdapter(jwt, new ConfigService(config));
            const token = await jwt.signAsync(
                { ...claims, revocationVersion },
                { secret: config.JWT_UPLOAD_SECRET, algorithm: 'HS256', noTimestamp: true },
            );
            await expect(adapter.verifyUploadToken(token, claims.purpose)).rejects.toBeInstanceOf(
                UnauthenticatedException,
            );
            await expect(adapter.verifyUploadToken(token, claims.purpose, true)).rejects.toBeInstanceOf(
                UnauthenticatedException,
            );
        },
    );
});
