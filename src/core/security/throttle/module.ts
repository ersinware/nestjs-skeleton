/**
 * @file throttle.module.ts
 * @description Local module configuring the NestJS ThrottlerModule and registering the FailSafeThrottlerGuard.
 */

import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { TOKEN_CACHE_STATE_CLIENT } from 'src/core/cache';
import { ENV } from 'src/core/config';
import { TooManyRequestsType } from 'src/core/exception';
import { FailSafeThrottlerGuard } from 'src/core/security/throttle/guard/fail-safe-throttler.guard';
import { ThrottlerName } from 'src/core/security/throttle/throttler-name.enum';

/**
 * Throttling configuration and guard activation module.
 */
@Module({
    imports: [
        ThrottlerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService, TOKEN_CACHE_STATE_CLIENT],
            useFactory: (config: ConfigService, redis: Redis) => ({
                errorMessage: TooManyRequestsType.DEFAULT,
                throttlers: [
                    {
                        name: ThrottlerName.DEFAULT,
                        ttl: config.getOrThrow<number>(ENV.THROTTLE_TTL),
                        limit: config.getOrThrow<number>(ENV.THROTTLE_LIMIT),
                    },
                    {
                        name: ThrottlerName.CRITICAL,
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
