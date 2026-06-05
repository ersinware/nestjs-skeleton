import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { getOptionsToken, getStorageToken, ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FailSafeThrottlerGuard } from './fail-safe-throttler.guard';

interface ThrottlerGuardSpyTarget {
    handleRequest: (request: ThrottlerRequest) => Promise<boolean>;
}

describe('FailSafeThrottlerGuard', () => {
    const mockRequest = {
            context: {} as unknown as ExecutionContext,
            limit: 10,
            ttl: 60,
            throttler: { name: 'default', limit: 10, ttl: 60 },
            blockDuration: 60,
            getTracker: vi.fn(),
            generateKey: vi.fn(),
        } satisfies ThrottlerRequest,
        mockParentGuard = ThrottlerGuard.prototype as unknown as ThrottlerGuardSpyTarget;

    let guard: FailSafeThrottlerGuard, configService: ConfigService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FailSafeThrottlerGuard,
                {
                    provide: getOptionsToken(),
                    useValue: {},
                },
                {
                    provide: getStorageToken(),
                    useValue: {},
                },
                {
                    provide: Reflector,
                    useValue: {},
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: vi.fn(),
                    },
                },
            ],
        }).compile();

        guard = module.get(FailSafeThrottlerGuard);
        configService = module.get(ConfigService);
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('should be defined', () => {
        expect(guard).toBeDefined();
    });

    describe('handleRequest', () => {
        it('should return true immediately when NODE_ENV is test', async () => {
            vi.spyOn(configService, 'get').mockReturnValueOnce('test');
            const superHandleRequestSpy = vi.spyOn(mockParentGuard, 'handleRequest');

            expect(await guard['handleRequest'](mockRequest)).toBe(true);
            expect(superHandleRequestSpy).not.toHaveBeenCalled();
        });

        it('should call super.handleRequest when NODE_ENV is not test', async () => {
            vi.spyOn(configService, 'get').mockReturnValueOnce('production');
            const superHandleRequestSpy = vi.spyOn(mockParentGuard, 'handleRequest').mockResolvedValueOnce(true);

            expect(await guard['handleRequest'](mockRequest)).toBe(true);
            expect(superHandleRequestSpy).toHaveBeenCalledWith(mockRequest);
        });

        it('should return true when super.handleRequest returns true', async () => {
            vi.spyOn(configService, 'get').mockReturnValueOnce('production');
            vi.spyOn(mockParentGuard, 'handleRequest').mockResolvedValueOnce(true);

            expect(await guard['handleRequest'](mockRequest)).toBe(true);
        });

        it('should return false when super.handleRequest returns false', async () => {
            vi.spyOn(configService, 'get').mockReturnValueOnce('production');
            vi.spyOn(mockParentGuard, 'handleRequest').mockResolvedValueOnce(false);

            expect(await guard['handleRequest'](mockRequest)).toBe(false);
        });

        it('should rethrow ThrottlerException when super.handleRequest throws it', async () => {
            vi.spyOn(configService, 'get').mockReturnValueOnce('production');

            const exception = new ThrottlerException();
            vi.spyOn(mockParentGuard, 'handleRequest').mockRejectedValueOnce(exception);

            await expect(guard['handleRequest'](mockRequest)).rejects.toThrow(exception);
            expect(console.error).not.toHaveBeenCalled();
        });

        it('should log storage error and return true (fail-open) when super.handleRequest throws a generic Error', async () => {
            vi.spyOn(configService, 'get').mockReturnValueOnce('production');
            vi.spyOn(mockParentGuard, 'handleRequest').mockRejectedValueOnce(new Error());

            expect(await guard['handleRequest'](mockRequest)).toBe(true);
            expect(console.error).toHaveBeenCalled();
        });

        it('should log string representation and return true (fail-open) when super.handleRequest throws a primitive string', async () => {
            vi.spyOn(configService, 'get').mockReturnValueOnce('production');
            vi.spyOn(mockParentGuard, 'handleRequest').mockRejectedValueOnce('string');

            expect(await guard['handleRequest'](mockRequest)).toBe(true);
            expect(console.error).toHaveBeenCalled();
        });

        it('should log string representation and return true (fail-open) when super.handleRequest throws null', async () => {
            vi.spyOn(configService, 'get').mockReturnValueOnce('production');
            vi.spyOn(mockParentGuard, 'handleRequest').mockRejectedValueOnce(null);

            expect(await guard['handleRequest'](mockRequest)).toBe(true);
            expect(console.error).toHaveBeenCalled();
        });
    });
});
