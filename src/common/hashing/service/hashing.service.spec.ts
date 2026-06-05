import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as argon2 from 'argon2';
import { HashingService } from './hashing.service';

vi.mock('argon2', () => ({
    hash: vi.fn(),
    verify: vi.fn(),
}));

describe('HashingService', () => {
    let service: HashingService;

    const mockedHash = vi.mocked(argon2.hash),
        mockedVerify = vi.mocked(argon2.verify);

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [HashingService],
        }).compile();

        service = module.get<HashingService>(HashingService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('hash', () => {
        const plainText = 'my-secure-password',
            expectedHash = '$argon2id$v=19$m=65536,t=3,p=4$somehashedstring';

        it('should successfully hash plain text using argon2', async () => {
            mockedHash.mockResolvedValueOnce(expectedHash);

            await expect(service.hash(plainText)).resolves.toBe(expectedHash);
            expect(mockedHash).toHaveBeenCalledWith(plainText);
        });

        it('should propagate argon2 error during hashing', async () => {
            mockedHash.mockRejectedValueOnce(new Error());

            await expect(service.hash(plainText)).rejects.toThrow(Error);
            expect(mockedHash).toHaveBeenCalledWith(plainText);
        });
    });

    describe('verify', () => {
        const hash = '$argon2id$v=19$m=65536,t=3,p=4$somehashedstring',
            plainText = 'my-secure-password';

        it('should return true when argon2 verification succeeds', async () => {
            mockedVerify.mockResolvedValueOnce(true);

            await expect(service.verify(hash, plainText)).resolves.toBe(true);
            expect(mockedVerify).toHaveBeenCalledWith(hash, plainText);
        });

        it('should return false when argon2 verification fails', async () => {
            mockedVerify.mockResolvedValueOnce(false);

            await expect(service.verify(hash, plainText)).resolves.toBe(false);
            expect(mockedVerify).toHaveBeenCalledWith(hash, plainText);
        });

        it('should propagate argon2 error during verification', async () => {
            mockedVerify.mockRejectedValueOnce(new Error());

            await expect(service.verify(hash, plainText)).rejects.toThrow(Error);
            expect(mockedVerify).toHaveBeenCalledWith(hash, plainText);
        });
    });
});
