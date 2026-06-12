/**
 * @file cache.module.ts
 * @description Global NestJS module establishing cache connections.
 * Manages connections and handles graceful shutdowns by closing active client connections.
 */

import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ENV } from 'src/common/config/constant/env.constant';
import {
    TOKEN_CACHE_CLEANER,
    TOKEN_CACHE_CLIENT,
    TOKEN_CACHE_HEALTH_INDICATOR,
    TOKEN_CACHE_SERVICE,
} from './constant/cache.constant';
import { RedisCacheService } from './service/redis-cache.service';
import { RedisCleaner } from './service/redis-cleaner.service';
import { RedisHealthIndicator } from './service/redis-health.indicator';

/**
 * Global module providing the cache client singleton across the application.
 */
@Global()
@Module({
    providers: [
        {
            inject: [ConfigService],
            provide: TOKEN_CACHE_CLIENT,
            useFactory: (config: ConfigService) => {
                const password = config.getOrThrow<string>(ENV.REDIS_PASSWORD),
                    redis = new Redis({
                        host: config.getOrThrow<string>(ENV.REDIS_HOST),
                        port: config.getOrThrow<number>(ENV.REDIS_PORT),
                        ...(password ? { password } : {}),
                        maxRetriesPerRequest: config.getOrThrow<number>(ENV.REDIS_MAX_RETRIES_PER_REQUEST),
                        commandTimeout: config.getOrThrow<number>(ENV.REDIS_COMMAND_TIMEOUT),
                    });

                redis.on('error', (error: Error) => {
                    console.error(`Redis connection failed: ${error.message}`);
                });

                return redis;
            },
        },
        {
            provide: TOKEN_CACHE_SERVICE,
            useClass: RedisCacheService,
        },
        {
            provide: TOKEN_CACHE_CLEANER,
            useClass: RedisCleaner,
        },
        {
            provide: TOKEN_CACHE_HEALTH_INDICATOR,
            useClass: RedisHealthIndicator,
        },
    ],
    exports: [TOKEN_CACHE_CLIENT, TOKEN_CACHE_SERVICE, TOKEN_CACHE_CLEANER, TOKEN_CACHE_HEALTH_INDICATOR],
})
export class CacheModule implements OnApplicationShutdown {
    /**
     * Creates an instance of CacheModule.
     *
     * @param redis The injected Redis client instance.
     */
    constructor(@Inject(TOKEN_CACHE_CLIENT) private readonly redis: Redis) {}

    /**
     * NestJS lifecycle hook called when the application is shutting down.
     * Closes the active Redis client connection pool gracefully.
     */
    async onApplicationShutdown() {
        await this.redis.quit();
    }
}
