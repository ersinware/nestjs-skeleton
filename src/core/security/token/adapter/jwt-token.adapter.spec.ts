/**
 * @file jwt-token.adapter.spec.ts
 * @description Verifies generic HS256 signing, expected-type checking, expiration bypass, and secret isolation.
 */

import { JwtService } from '@nestjs/jwt';
import { JwtTokenAdapter } from 'src/core/security/token/adapter/jwt-token.adapter';
import type { TokenPayload } from 'src/core/security/token/port/token.port';
import { UnauthenticatedException } from 'src/shared/exception';
import { nowEpochSeconds } from 'src/shared/time';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Opaque claims used to exercise the generic token contract.
 */
type SamplePayload = TokenPayload<'sample' | 'other'> & {
    /**
     * Caller-owned subject preserved by signing.
     */
    readonly sub: string;
    /**
     * Caller-owned credential deadline in Unix seconds.
     */
    readonly exp: number;
};

describe('JwtTokenAdapter', () => {
    const jwtService = new JwtService(),
        secret = 'a'.repeat(32),
        otherSecret = 'b'.repeat(32);

    let adapter: JwtTokenAdapter<'sample' | 'other'>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-13T00:00:00Z'));
        adapter = new JwtTokenAdapter(jwtService, secret);
    });

    afterEach(() => vi.useRealTimers());

    it('signs with HS256 and verifies matching type payloads', async () => {
        const exp = nowEpochSeconds() + 60,
            token = await adapter.sign<SamplePayload>('sample', { sub: 'principal-1', exp });

        await expect(adapter.verify<SamplePayload>(token, 'sample')).resolves.toEqual({
            sub: 'principal-1',
            exp,
            type: 'sample',
        });
    });

    it('rejects tokens with unexpected type or different secret', async () => {
        const exp = nowEpochSeconds() + 60,
            token = await adapter.sign<SamplePayload>('sample', { sub: 'principal-1', exp }),
            otherAdapter = new JwtTokenAdapter<'sample' | 'other'>(jwtService, otherSecret);

        await expect(adapter.verify<SamplePayload>(token, 'other')).rejects.toThrow(UnauthenticatedException);
        await expect(otherAdapter.verify<SamplePayload>(token, 'sample')).rejects.toThrow(UnauthenticatedException);
    });

    it('enforces expiration by default and allows bypass with ignoreExpiration', async () => {
        const exp = nowEpochSeconds() + 60,
            token = await adapter.sign<SamplePayload>('sample', { sub: 'principal-1', exp });

        vi.setSystemTime(exp * 1000);

        await expect(adapter.verify<SamplePayload>(token, 'sample')).rejects.toThrow(UnauthenticatedException);
        await expect(adapter.verify<SamplePayload>(token, 'sample', { ignoreExpiration: true })).resolves.toEqual({
            sub: 'principal-1',
            exp,
            type: 'sample',
        });
    });

    it('preserves fixed claims and deadlines across later delivery attempts', async () => {
        const claims = { sub: 'principal-1', exp: nowEpochSeconds() + 60 },
            first = await adapter.sign<SamplePayload>('sample', claims);

        vi.setSystemTime(Date.now() + 30_000);

        const retry = await adapter.sign<SamplePayload>('sample', claims);

        expect(retry).toBe(first);
        expect(jwtService.decode(retry)).not.toHaveProperty('iat');
    });

    it('rejects wrong algorithms, future not-before, and malformed JWTs', async () => {
        const claims = { sub: 'principal-1', exp: nowEpochSeconds() + 60, type: 'sample' },
            wrongAlgorithm = await jwtService.signAsync(claims, { secret, algorithm: 'HS384' }),
            tooEarly = await jwtService.signAsync({ ...claims, nbf: claims.exp - 1 }, { secret, algorithm: 'HS256' });

        for (const token of [wrongAlgorithm, tooEarly, 'not-a-jwt']) {
            await expect(adapter.verify<SamplePayload>(token, 'sample')).rejects.toThrow(UnauthenticatedException);
        }
    });

    it('propagates unexpected signer and verifier failures unchanged', async () => {
        const failure = new Error('unexpected dependency failure');

        vi.spyOn(jwtService, 'signAsync').mockRejectedValueOnce(failure);
        await expect(adapter.sign<SamplePayload>('sample', { sub: 'principal-1', exp: 1 })).rejects.toBe(failure);
        vi.spyOn(jwtService, 'verifyAsync').mockRejectedValueOnce(failure);
        await expect(adapter.verify<SamplePayload>('token', 'sample')).rejects.toBe(failure);
    });
});
