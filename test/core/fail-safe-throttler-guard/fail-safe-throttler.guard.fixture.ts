/**
 * @file fail-safe-throttler.guard.fixture.ts
 * @description Test utility helpers and mock trigger controller to facilitate E2E tests for Throttler guard.
 */

import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { getStorageToken } from '@nestjs/throttler';
import { Public } from 'src/common/decorator/auth/public.decorator';
import { vi } from 'vitest';
import { createTestApp } from '../../shared/test-app.factory';

/**
 * Helper to build a NestFastifyApplication configured with a spied ConfigService
 * and optionally a faulty throttler storage service to test fail-safe rate limiting behaviors.
 *
 * @param options App configuration options.
 * @param options.nodeEnv Target NODE_ENV override value.
 * @param options.limit Rate limit threshold override.
 * @param options.faultyStorage If true, configures rate-limiter storage provider to reject requests.
 * @returns A promise resolving to the created Fastify app instance.
 */
export async function createFailSafeThrottlerTestApp(options: {
    nodeEnv: string;
    limit: number;
    faultyStorage: boolean;
}): Promise<NestFastifyApplication> {
    const overrides: { provide: unknown; useValue: unknown }[] = [
        {
            provide: ConfigService,
            useValue: {
                get: vi.fn((key: string) => {
                    if (key === 'NODE_ENV') {
                        return options.nodeEnv;
                    }

                    return process.env[key];
                }),
                getOrThrow: vi.fn((key: string) => {
                    if (key === 'THROTTLE_LIMIT') {
                        return options.limit;
                    }

                    if (key === 'THROTTLE_TTL') {
                        return 60000;
                    }

                    return process.env[key];
                }),
            },
        },
    ];

    if (options.faultyStorage) {
        overrides.push({
            provide: getStorageToken(),
            useValue: {
                increment: vi.fn().mockRejectedValue(new Error()),
            },
        });
    }

    return createTestApp({
        extraControllers: [FailSafeThrottlerTriggerController],
        overrides,
    });
}

@Controller('fail-safe-throttler-trigger')
@Public()
export class FailSafeThrottlerTriggerController {
    @Get('test')
    test() {
        return { success: true };
    }
}
