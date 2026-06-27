/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file fail-safe-throttler.guard.spec.ts
 * @description Unit tests for the fail-safe throttler rate-limiting guard.
 */

import { ExecutionContext } from '@nestjs/common';
import { TOKEN_LOGGER_SERVICE } from 'src/common/port/logger/logger.constant';
import type { ILoggerService } from 'src/common/port/logger/logger.service.interface';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { getOptionsToken, getStorageToken, ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Environment } from 'src/common/config/enum/environment.enum';
import { FailSafeThrottlerGuard } from './fail-safe-throttler.guard';
import * as Sentry from '@sentry/nestjs';
import { LogPayload } from 'src/common/port/logger/payload/log-payload';
import { ThrottlerName } from 'src/common/throttle/enum/throttler-name.enum';

vi.mock('@sentry/nestjs', () => ({
    captureException: vi.fn(),
}));

interface ThrottlerGuardSpyTarget {
    handleRequest: (request: ThrottlerRequest) => Promise<boolean>;
}

describe('FailSafeThrottlerGuard', () => {
    const mockRequest = {
            context: {
                getHandler: vi.fn(),
                getClass: vi.fn(),
            } as unknown as ExecutionContext,
            limit: 10,
            ttl: 60,
            throttler: { name: ThrottlerName.DEFAULT, limit: 10, ttl: 60 },
            blockDuration: 60,
            getTracker: vi.fn(),
            generateKey: vi.fn(),
        } satisfies ThrottlerRequest,
        mockParentGuard = ThrottlerGuard.prototype as unknown as ThrottlerGuardSpyTarget,
        mockLogger = {
            error: vi.fn(),
            warn: vi.fn(),
            log: vi.fn(),
        } as unknown as ILoggerService;

    let guard: FailSafeThrottlerGuard, configService: ConfigService, reflector: Reflector;

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
                    useValue: {
                        getAllAndOverride: vi.fn(),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        getOrThrow: vi.fn(),
                    },
                },
                { provide: TOKEN_LOGGER_SERVICE, useValue: mockLogger },
            ],
        }).compile();

        guard = module.get(FailSafeThrottlerGuard);
        configService = module.get(ConfigService);
        reflector = module.get(Reflector);
    });

    it('should be defined', () => {
        expect(guard).toBeDefined();
    });

    describe('handleRequest', () => {
        it('should return true immediately when NODE_ENV is test', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.TEST);
            const superHandleRequestSpy = vi.spyOn(mockParentGuard, 'handleRequest');

            expect(await guard['handleRequest'](mockRequest)).toBe(true);
            expect(superHandleRequestSpy).not.toHaveBeenCalled();
        });

        it('should call super.handleRequest when NODE_ENV is not test', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(false);
            const superHandleRequestSpy = vi.spyOn(mockParentGuard, 'handleRequest').mockResolvedValueOnce(true);

            expect(await guard['handleRequest'](mockRequest)).toBe(true);
            expect(superHandleRequestSpy).toHaveBeenCalledWith(mockRequest);
        });

        it('should bypass the default throttler if the route is critical', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true);
            const superHandleRequestSpy = vi.spyOn(mockParentGuard, 'handleRequest');

            const result = await guard['handleRequest']({
                ...mockRequest,
                throttler: { name: ThrottlerName.DEFAULT, limit: 10, ttl: 60 },
            });
            expect(result).toBe(true);
            expect(superHandleRequestSpy).not.toHaveBeenCalled();
        });

        it('should bypass the critical throttler if the route is not critical', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(false);
            const superHandleRequestSpy = vi.spyOn(mockParentGuard, 'handleRequest');

            const result = await guard['handleRequest']({
                ...mockRequest,
                throttler: { name: ThrottlerName.CRITICAL, limit: 5, ttl: 60 },
            });
            expect(result).toBe(true);
            expect(superHandleRequestSpy).not.toHaveBeenCalled();
        });

        it('should run super.handleRequest if the route is critical and critical throttler is evaluated', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true);
            const superHandleRequestSpy = vi.spyOn(mockParentGuard, 'handleRequest').mockResolvedValueOnce(true);

            const criticalRequest = {
                ...mockRequest,
                throttler: { name: ThrottlerName.CRITICAL, limit: 5, ttl: 60 },
            };

            const result = await guard['handleRequest'](criticalRequest);
            expect(result).toBe(true);
            expect(superHandleRequestSpy).toHaveBeenCalledWith(criticalRequest);
        });

        it('should return true when super.handleRequest returns true', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(false);
            vi.spyOn(mockParentGuard, 'handleRequest').mockResolvedValueOnce(true);

            expect(await guard['handleRequest'](mockRequest)).toBe(true);
        });

        it('should return false when super.handleRequest returns false', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(false);
            vi.spyOn(mockParentGuard, 'handleRequest').mockResolvedValueOnce(false);

            expect(await guard['handleRequest'](mockRequest)).toBe(false);
        });

        it('should rethrow ThrottlerException when super.handleRequest throws it', async () => {
            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(false);

            const exception = new ThrottlerException();
            vi.spyOn(mockParentGuard, 'handleRequest').mockRejectedValueOnce(exception);

            await expect(guard['handleRequest'](mockRequest)).rejects.toThrow(exception);
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        it('should log storage error and return true (fail-open) when super.handleRequest throws a generic Error', async () => {
            const error = new Error();

            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(false);
            vi.spyOn(mockParentGuard, 'handleRequest').mockRejectedValueOnce(error);

            expect(await guard['handleRequest'](mockRequest)).toBe(true);

            expect(mockLogger.error).toHaveBeenCalledWith(
                new LogPayload({
                    class: FailSafeThrottlerGuard.name,
                    method: guard['handleRequest'].name,
                    error,
                }),
            );
            expect(Sentry.captureException).toHaveBeenCalledWith(error);
        });

        it('should log string representation and return true (fail-open) when super.handleRequest throws a primitive string', async () => {
            const error = 'string error';

            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(false);
            vi.spyOn(mockParentGuard, 'handleRequest').mockRejectedValueOnce(error);

            expect(await guard['handleRequest'](mockRequest)).toBe(true);

            expect(mockLogger.error).toHaveBeenCalledWith(
                new LogPayload({
                    class: FailSafeThrottlerGuard.name,
                    method: guard['handleRequest'].name,
                    error: new Error(error),
                }),
            );
            expect(Sentry.captureException).toHaveBeenCalledWith(new Error(error));
        });

        it('should log string representation and return true (fail-open) when super.handleRequest throws null', async () => {
            const error = null;

            vi.spyOn(configService, 'getOrThrow').mockReturnValueOnce(Environment.PRODUCTION);
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(false);
            vi.spyOn(mockParentGuard, 'handleRequest').mockRejectedValueOnce(error);

            expect(await guard['handleRequest'](mockRequest)).toBe(true);

            expect(mockLogger.error).toHaveBeenCalledWith(
                new LogPayload({
                    class: FailSafeThrottlerGuard.name,
                    method: guard['handleRequest'].name,
                    error: new Error(String(error)),
                }),
            );
            expect(Sentry.captureException).toHaveBeenCalledWith(new Error(String(error)));
        });
    });
});
