/**
 * @file throttle.module.ts
 * @description Local module configuring the NestJS ThrottlerModule and registering the FailSafeThrottlerGuard.
 */

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { TOKEN_CACHE_STATE_CLIENT } from 'src/cache/constant/cache.constant';
import { ENV } from 'src/common/config/constant/env.constant';
import { THROTTLER_NAME } from 'src/throttle/constant/throttle.constant';
import { FailSafeThrottlerGuard } from 'src/throttle/guard/fail-safe-throttler.guard';

/**
 * Throttling configuration and guard activation module.
 */
@Module({
    imports: [
        ThrottlerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService, TOKEN_CACHE_STATE_CLIENT],
            useFactory: (config: ConfigService, redis: Redis) => ({
                errorMessage: 'Too many requests.',
                throttlers: [
                    {
                        name: THROTTLER_NAME.DEFAULT,
                        ttl: config.getOrThrow<number>(ENV.THROTTLE_TTL),
                        limit: config.getOrThrow<number>(ENV.THROTTLE_LIMIT),
                    },
                    {
                        name: THROTTLER_NAME.CRITICAL,
                        ttl: config.getOrThrow<number>(ENV.THROTTLE_CRITICAL_TTL),
                        limit: config.getOrThrow<number>(ENV.THROTTLE_CRITICAL_LIMIT),
                    },
                ],
                storage: new ThrottlerStorageRedisService(redis),
            }),
        }),
    ],
    providers: [
        {
            provide: APP_GUARD,
            useClass: FailSafeThrottlerGuard,
        },
    ],
})
export class ThrottleModule {}
