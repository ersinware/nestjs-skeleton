/**
 * @file hashing.adapter.spec.ts
 * @description Unit tests for the password and HMAC hashing adapter.
 */

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { ENV, Environment } from 'src/core/config';
import { HashingAdapter } from 'src/core/security/hashing/adapter/hashing.adapter';
import { describe, expect, it, vi } from 'vitest';

vi.mock('argon2', () => ({
    hash: vi.fn(),
    verify: vi.fn(),
}));

describe('HashingAdapter', () => {
    const mockedHash = vi.mocked(argon2.hash),
        mockedVerify = vi.mocked(argon2.verify);

    // The adapter reads NODE_ENV once at construction, so each test builds it for the environment it exercises.
    async function createAdapter(environment: Environment): Promise<HashingAdapter> {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                HashingAdapter,
                {
                    provide: ConfigService,
                    useValue: new ConfigService({
                        [ENV.NODE_ENV]: environment,
                        [ENV.HASHING_KEY]: 'test-only-hashing-key-not-for-production',
                    }),
                },
            ],
        }).compile();

        return module.get<HashingAdapter>(HashingAdapter);
    }

    it('should be defined', async () => {
        await expect(createAdapter(Environment.PRODUCTION)).resolves.toBeDefined();
    });

    describe('hashPassword', () => {
        const plainText = 'my-secure-password',
            expectedHash = '$argon2id$v=19$m=65536,t=3,p=4$somehashedstring';

        it('should hash plain text with the OWASP minimum argon2 profile in non-test env', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION);
            mockedHash.mockResolvedValueOnce(expectedHash);

            await expect(adapter.hashPassword(plainText)).resolves.toBe(expectedHash);
            expect(mockedHash).toHaveBeenCalledWith(plainText, {
                timeCost: 2,
                memoryCost: 19456,
                parallelism: 1,
            });
        });

        it('should use weak argon2 settings in test env to optimize performance', async () => {
            const adapter = await createAdapter(Environment.TEST);
            mockedHash.mockResolvedValueOnce(expectedHash);

            await expect(adapter.hashPassword(plainText)).resolves.toBe(expectedHash);
            expect(mockedHash).toHaveBeenCalledWith(plainText, {
                timeCost: 1,
                memoryCost: 8,
                parallelism: 1,
            });
        });

        it('should propagate argon2 error during hashing', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION);
            mockedHash.mockRejectedValueOnce(new Error());

            await expect(adapter.hashPassword(plainText)).rejects.toThrow(Error);
            expect(mockedHash).toHaveBeenCalledWith(plainText, expect.any(Object));
        });
    });

    describe('verifyPassword', () => {
        const hash = '$argon2id$v=19$m=65536,t=3,p=4$somehashedstring',
            plainText = 'my-secure-password';

        it('should return true when argon2 verification succeeds', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION);
            mockedVerify.mockResolvedValueOnce(true);

            await expect(adapter.verifyPassword(hash, plainText)).resolves.toBe(true);
            expect(mockedVerify).toHaveBeenCalledWith(hash, plainText);
        });

        it('should return false when argon2 verification fails', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION);
            mockedVerify.mockResolvedValueOnce(false);

            await expect(adapter.verifyPassword(hash, plainText)).resolves.toBe(false);
            expect(mockedVerify).toHaveBeenCalledWith(hash, plainText);
        });

        it('should propagate argon2 error during verification', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION);
            mockedVerify.mockRejectedValueOnce(new Error());

            await expect(adapter.verifyPassword(hash, plainText)).rejects.toThrow(Error);
            expect(mockedVerify).toHaveBeenCalledWith(hash, plainText);
        });
    });

    describe('verifyHmacSha256', () => {
        it('accepts the original binding and rejects changed inputs, keys, and malformed digests', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION);
            const digest = adapter.hmacSha256('purpose', 'value');
            const otherAdapter = new HashingAdapter(
                new ConfigService({
                    [ENV.NODE_ENV]: Environment.PRODUCTION,
                    [ENV.HASHING_KEY]: 'another-test-only-key-not-for-production',
                }),
            );
            expect(adapter.verifyHmacSha256('purpose', 'value', digest)).toBe(true);
            expect(adapter.verifyHmacSha256('purpose', 'changed', digest)).toBe(false);
            expect(adapter.verifyHmacSha256('other-purpose', 'value', digest)).toBe(false);
            expect(otherAdapter.verifyHmacSha256('purpose', 'value', digest)).toBe(false);
            for (const malformed of ['', 'short', 'x'.repeat(64), digest.toUpperCase()]) {
                expect(adapter.verifyHmacSha256('purpose', 'value', malformed)).toBe(false);
            }
        });
    });

    describe('hmacSha256', () => {
        it('returns the stable UTF-8 context/value HMAC as lowercase hex', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION);

            expect(adapter.hmacSha256('idempotency-fingerprint', 'şifre🔑')).toBe(
                'ddd4bc67485d14228110d5f031b5f2e6f9e5d3b084e3e5b9067db4ad92e77afa',
            );
            expect(adapter.hmacSha256('idempotency-fingerprint', 'şifre🔑')).toBe(
                (await createAdapter(Environment.PRODUCTION)).hmacSha256('idempotency-fingerprint', 'şifre🔑'),
            );
        });

        it('separates purposes, values, and ambiguous concatenation pairs', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION);

            expect(adapter.hmacSha256('first', 'value')).not.toBe(adapter.hmacSha256('second', 'value'));
            expect(adapter.hmacSha256('first', 'value')).not.toBe(adapter.hmacSha256('first', 'changed'));
            expect(adapter.hmacSha256('ab', 'c')).not.toBe(adapter.hmacSha256('a', 'bc'));
        });

        it('uses the configured server key', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION),
                otherAdapter = new HashingAdapter(
                    new ConfigService({
                        [ENV.NODE_ENV]: Environment.PRODUCTION,
                        [ENV.HASHING_KEY]: 'another-test-only-key-not-for-production',
                    }),
                );

            expect(adapter.hmacSha256('purpose', 'value')).not.toBe(otherAdapter.hmacSha256('purpose', 'value'));
        });
    });
});
