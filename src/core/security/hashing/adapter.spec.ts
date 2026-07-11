/**
 * @file hashing.service.spec.ts
 * @description Unit tests for the password hashing service.
 */

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { Environment } from 'src/core/config';
import { HashingPort } from 'src/core/security/hashing/adapter';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('argon2', () => ({
    hash: vi.fn(),
    verify: vi.fn(),
}));

describe('HashingService', () => {
    const mockedHash = vi.mocked(argon2.hash),
        mockedVerify = vi.mocked(argon2.verify),
        mockConfigService = {
            getOrThrow: vi.fn(),
        };

    let adapter: HashingPort, configService: ConfigService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                HashingPort,
                {
                    provide: ConfigService,
                    useValue: mockConfigService,
                },
            ],
        }).compile();

        adapter = module.get<HashingPort>(HashingPort);
        configService = module.get<ConfigService>(ConfigService);
    });

    it('should be defined', () => {
        expect(adapter).toBeDefined();
    });

    describe('hash', () => {
        const plainText = 'my-secure-password',
            expectedHash = '$argon2id$v=19$m=65536,t=3,p=4$somehashedstring';

        it('should successfully hash plain text using default argon2 config in non-test env', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            mockedHash.mockResolvedValueOnce(expectedHash);

            await expect(adapter.hash(plainText)).resolves.toBe(expectedHash);
            expect(mockedHash).toHaveBeenCalledWith(plainText);
        });

        it('should use weak argon2 settings in test env to optimize performance', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.TEST);
            mockedHash.mockResolvedValueOnce(expectedHash);

            await expect(adapter.hash(plainText)).resolves.toBe(expectedHash);
            expect(mockedHash).toHaveBeenCalledWith(plainText, {
                timeCost: 1,
                memoryCost: 8,
                parallelism: 1,
            });
        });

        it('should propagate argon2 error during hashing', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            mockedHash.mockRejectedValueOnce(new Error());

            await expect(adapter.hash(plainText)).rejects.toThrow(Error);
            expect(mockedHash).toHaveBeenCalledWith(plainText);
        });
    });

    describe('verify', () => {
        const hash = '$argon2id$v=19$m=65536,t=3,p=4$somehashedstring',
            plainText = 'my-secure-password';

        it('should return true when argon2 verification succeeds', async () => {
            mockedVerify.mockResolvedValueOnce(true);

            await expect(adapter.verify(hash, plainText)).resolves.toBe(true);
            expect(mockedVerify).toHaveBeenCalledWith(hash, plainText);
        });

        it('should return false when argon2 verification fails', async () => {
            mockedVerify.mockResolvedValueOnce(false);

            await expect(adapter.verify(hash, plainText)).resolves.toBe(false);
            expect(mockedVerify).toHaveBeenCalledWith(hash, plainText);
        });

        it('should propagate argon2 error during verification', async () => {
            mockedVerify.mockRejectedValueOnce(new Error());

            await expect(adapter.verify(hash, plainText)).rejects.toThrow(Error);
            expect(mockedVerify).toHaveBeenCalledWith(hash, plainText);
        });
    });
});
