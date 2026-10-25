/**
 * @file module.ts
 * @description NestJS module establishing the cache connection.
 * Manages the connection and handles graceful shutdowns by closing the active client connection.
 */

import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CacheCleanerAdapter } from 'src/core/cache/adapter/cache-cleaner.adapter';
import { CacheEvictionAdapter } from 'src/core/cache/adapter/cache-eviction.adapter';
import { CacheHealthAdapter } from 'src/core/cache/adapter/cache-health.adapter';
import { CacheAdapter } from 'src/core/cache/adapter/cache.adapter';
import { TOKEN_CACHE_CONNECTION } from 'src/core/cache/cache-connection.token';
import { TOKEN_CACHE_CLEANER_PORT } from 'src/core/cache/port/cache-cleaner.port';
import { TOKEN_CACHE_EVICTION_PORT } from 'src/core/cache/port/cache-eviction.port';
import { TOKEN_CACHE_HEALTH_PORT } from 'src/core/cache/port/cache-health.port';
import { TOKEN_CACHE_PORT } from 'src/core/cache/port/cache.port';
import { ENV } from 'src/core/config';
import { LoggerModule, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { createRedisClient } from 'src/core/redis';

/**
 * Module providing the cache client singleton and the cache ports to the modules that import it.
 */
@Module({
    imports: [LoggerModule],
    providers: [
        {
            inject: [ConfigService, TOKEN_LOGGER_PORT],
            provide: TOKEN_CACHE_CONNECTION,
            useFactory: (configService: ConfigService, logger: ILoggerPort) =>
                createRedisClient(
                    configService,
                    logger,
                    {
                        host: ENV.REDIS_CACHE_HOST,
                        port: ENV.REDIS_CACHE_PORT,
                        password: ENV.REDIS_CACHE_PASSWORD,
                        tls: ENV.REDIS_CACHE_TLS,
                        connectTimeout: ENV.REDIS_CACHE_CONNECT_TIMEOUT,
                        maxRetriesPerRequest: ENV.REDIS_CACHE_MAX_RETRIES_PER_REQUEST,
                        commandTimeout: ENV.REDIS_CACHE_COMMAND_TIMEOUT,
                    },
                    TOKEN_CACHE_CONNECTION,
                ),
        },
        {
            provide: TOKEN_CACHE_PORT,
            useClass: CacheAdapter,
        },
        {
            provide: TOKEN_CACHE_EVICTION_PORT,
            useClass: CacheEvictionAdapter,
        },
        {
            provide: TOKEN_CACHE_CLEANER_PORT,
            useClass: CacheCleanerAdapter,
        },
        {
            provide: TOKEN_CACHE_HEALTH_PORT,
            useClass: CacheHealthAdapter,
        },
    ],
    exports: [TOKEN_CACHE_PORT, TOKEN_CACHE_EVICTION_PORT, TOKEN_CACHE_CLEANER_PORT, TOKEN_CACHE_HEALTH_PORT],
})
export class CacheModule implements OnApplicationShutdown {
    /**
     * Retains the cache Redis connection for orderly shutdown.
     *
     * @param cacheRedis The injected cache Redis client instance.
     */
    constructor(@Inject(TOKEN_CACHE_CONNECTION) private readonly cacheRedis: Redis) {}

    /**
     * NestJS lifecycle hook called when the application is shutting down.
     * Closes the active Redis client connection gracefully.
     */
    async onApplicationShutdown() {
        await this.cacheRedis.quit();
    }
}
