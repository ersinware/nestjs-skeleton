/**
 * @file hashing.adapter.spec.ts
 * @description Unit tests for the Argon2 hashing adapter.
 */

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { Environment } from 'src/core/config';
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
                    useValue: {
                        getOrThrow: vi.fn().mockReturnValue(environment),
                    },
                },
            ],
        }).compile();

        return module.get<HashingAdapter>(HashingAdapter);
    }

    it('should be defined', async () => {
        await expect(createAdapter(Environment.PRODUCTION)).resolves.toBeDefined();
    });

    describe('hash', () => {
        const plainText = 'my-secure-password',
            expectedHash = '$argon2id$v=19$m=65536,t=3,p=4$somehashedstring';

        it('should successfully hash plain text using default argon2 config in non-test env', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION);
            mockedHash.mockResolvedValueOnce(expectedHash);

            await expect(adapter.hash(plainText)).resolves.toBe(expectedHash);
            expect(mockedHash).toHaveBeenCalledWith(plainText);
        });

        it('should use weak argon2 settings in test env to optimize performance', async () => {
            const adapter = await createAdapter(Environment.TEST);
            mockedHash.mockResolvedValueOnce(expectedHash);

            await expect(adapter.hash(plainText)).resolves.toBe(expectedHash);
            expect(mockedHash).toHaveBeenCalledWith(plainText, {
                timeCost: 1,
                memoryCost: 8,
                parallelism: 1,
            });
        });

        it('should propagate argon2 error during hashing', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION);
            mockedHash.mockRejectedValueOnce(new Error());

            await expect(adapter.hash(plainText)).rejects.toThrow(Error);
            expect(mockedHash).toHaveBeenCalledWith(plainText);
        });
    });

    describe('verify', () => {
        const hash = '$argon2id$v=19$m=65536,t=3,p=4$somehashedstring',
            plainText = 'my-secure-password';

        it('should return true when argon2 verification succeeds', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION);
            mockedVerify.mockResolvedValueOnce(true);

            await expect(adapter.verify(hash, plainText)).resolves.toBe(true);
            expect(mockedVerify).toHaveBeenCalledWith(hash, plainText);
        });

        it('should return false when argon2 verification fails', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION);
            mockedVerify.mockResolvedValueOnce(false);

            await expect(adapter.verify(hash, plainText)).resolves.toBe(false);
            expect(mockedVerify).toHaveBeenCalledWith(hash, plainText);
        });

        it('should propagate argon2 error during verification', async () => {
            const adapter = await createAdapter(Environment.PRODUCTION);
            mockedVerify.mockRejectedValueOnce(new Error());

            await expect(adapter.verify(hash, plainText)).rejects.toThrow(Error);
            expect(mockedVerify).toHaveBeenCalledWith(hash, plainText);
        });
    });
});
