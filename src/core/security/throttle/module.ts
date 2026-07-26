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
import { CacheModule, TOKEN_CACHE_STATE_CLIENT } from 'src/core/cache';
import { ENV } from 'src/core/config';
import { AuditModule } from 'src/core/observability/audit';
import { FailSafeThrottlerGuard } from 'src/core/security/throttle/guard/fail-safe-throttler.guard';
import { RateLimitMessage } from 'src/core/security/throttle/rate-limit-message.enum';
import { ThrottlerName } from 'src/core/security/throttle/throttler-name.enum';

/**
 * Throttling configuration and guard activation module.
 */
@Module({
    imports: [
        // The guard writes the RATE_LIMITED record itself: a block is established here and nowhere
        // else, and only here is the crossing distinguishable from the refusals that follow it.
        AuditModule,
        ThrottlerModule.forRootAsync({
            imports: [ConfigModule, CacheModule],
            inject: [ConfigService, TOKEN_CACHE_STATE_CLIENT],
            useFactory: (config: ConfigService, redis: Redis) => ({
                errorMessage: RateLimitMessage.DEFAULT,
                // `blockDuration` is stated on every limiter rather than left to default to `ttl`,
                // because it is the only lever that decides what exceeding a limit actually COSTS: the
                // window merely expires, whereas the block is a separate penalty key. It is deliberately
                // kept close to each window for now — the tracker is an IP address, so a long block
                // punishes everyone sharing that address far more reliably than it punishes an attacker,
                // who changes address for free. It earns longer values once the tracker is an identity.
                throttlers: [
                    {
                        name: ThrottlerName.DEFAULT,
                        ttl: config.getOrThrow<number>(ENV.THROTTLE_TTL),
                        limit: config.getOrThrow<number>(ENV.THROTTLE_LIMIT),
                        blockDuration: config.getOrThrow<number>(ENV.THROTTLE_BLOCK_DURATION),
                    },
                    {
                        name: ThrottlerName.CRITICAL_BURST,
                        ttl: config.getOrThrow<number>(ENV.THROTTLE_CRITICAL_BURST_TTL),
                        limit: config.getOrThrow<number>(ENV.THROTTLE_CRITICAL_BURST_LIMIT),
                        blockDuration: config.getOrThrow<number>(ENV.THROTTLE_CRITICAL_BURST_BLOCK_DURATION),
                    },
                    {
                        name: ThrottlerName.CRITICAL_SUSTAINED,
                        ttl: config.getOrThrow<number>(ENV.THROTTLE_CRITICAL_SUSTAINED_TTL),
                        limit: config.getOrThrow<number>(ENV.THROTTLE_CRITICAL_SUSTAINED_LIMIT),
                        blockDuration: config.getOrThrow<number>(ENV.THROTTLE_CRITICAL_SUSTAINED_BLOCK_DURATION),
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
