/**
 * @file cache.module.ts
 * @description Global NestJS module establishing cache connections.
 * Manages connections and handles graceful shutdowns by closing active client connections.
 */

import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import Redis from 'ioredis';
import { ENV } from 'src/common/config/constant/env.constant';
import {
    TOKEN_CACHE_CLEANER_SERVICE,
    TOKEN_CACHE_CLIENT,
    TOKEN_CACHE_HEALTH_INDICATOR,
    TOKEN_CACHE_SERVICE,
    TOKEN_CACHE_STATE_CLIENT,
    TOKEN_CACHE_STATE_SERVICE,
} from 'src/common/port/cache/cache.constant';
import { RedisService } from './service/redis.service';
import { RedisStateService } from './service/redis-state.service';
import { RedisCleanerService } from './service/redis-cleaner.service';
import { RedisHealthIndicator } from './service/redis-health.indicator';
import { LogPayload } from 'src/common/port/logger/payload/log-payload';

/**
 * Helper function to create a configured Redis client instance.
 *
 * @param config The config service instance.
 * @param logger The logger service instance.
 * @param env The configuration keys for this specific client.
 * @param clientName The name of the client to use in error logs.
 * @returns The initialized Redis client instance.
 */
function createRedisClient(
    config: ConfigService,
    logger: Logger,
    env: { host: string; port: string; password: string; tls: string },
    clientName: string,
) {
    const password = config.getOrThrow<string>(env.password),
        tlsEnabled = config.getOrThrow<boolean>(env.tls),
        redis = new Redis({
            host: config.getOrThrow<string>(env.host),
            port: config.getOrThrow<number>(env.port),
            ...(password ? { password } : {}),
            ...(tlsEnabled ? { tls: {} } : {}),
            maxRetriesPerRequest: config.getOrThrow<number>(ENV.REDIS_MAX_RETRIES_PER_REQUEST),
            commandTimeout: config.getOrThrow<number>(ENV.REDIS_COMMAND_TIMEOUT),
        });

    redis.on('error', (error: Error) => {
        logger.error(new LogPayload({ class: CacheModule.name, method: `${clientName}.on(error)`, error }));
    });

    return redis;
}

/**
 * Global module providing the cache client singleton across the application.
 */
@Global()
@Module({
    providers: [
        {
            inject: [ConfigService, Logger],
            provide: TOKEN_CACHE_CLIENT,
            useFactory: (config: ConfigService, logger: Logger) =>
                createRedisClient(
                    config,
                    logger,
                    {
                        host: ENV.REDIS_CACHE_HOST,
                        port: ENV.REDIS_CACHE_PORT,
                        password: ENV.REDIS_CACHE_PASSWORD,
                        tls: ENV.REDIS_CACHE_TLS,
                    },
                    'TOKEN_CACHE_CLIENT',
                ),
        },
        {
            inject: [ConfigService, Logger],
            provide: TOKEN_CACHE_STATE_CLIENT,
            useFactory: (config: ConfigService, logger: Logger) =>
                createRedisClient(
                    config,
                    logger,
                    {
                        host: ENV.REDIS_STATE_HOST,
                        port: ENV.REDIS_STATE_PORT,
                        password: ENV.REDIS_STATE_PASSWORD,
                        tls: ENV.REDIS_STATE_TLS,
                    },
                    'TOKEN_CACHE_STATE_CLIENT',
                ),
        },
        {
            provide: TOKEN_CACHE_SERVICE,
            useClass: RedisService,
        },
        {
            provide: TOKEN_CACHE_STATE_SERVICE,
            useClass: RedisStateService,
        },
        {
            provide: TOKEN_CACHE_CLEANER_SERVICE,
            useClass: RedisCleanerService,
        },
        {
            provide: TOKEN_CACHE_HEALTH_INDICATOR,
            useClass: RedisHealthIndicator,
        },
    ],
    exports: [
        TOKEN_CACHE_CLIENT,
        TOKEN_CACHE_STATE_CLIENT,
        TOKEN_CACHE_SERVICE,
        TOKEN_CACHE_STATE_SERVICE,
        TOKEN_CACHE_CLEANER_SERVICE,
        TOKEN_CACHE_HEALTH_INDICATOR,
    ],
})
export class CacheModule implements OnApplicationShutdown {
    /**
     * Creates an instance of CacheModule.
     *
     * @param cacheRedis The injected Cache Redis client instance.
     * @param stateRedis The injected State Redis client instance.
     */
    constructor(
        @Inject(TOKEN_CACHE_CLIENT) private readonly cacheRedis: Redis,
        @Inject(TOKEN_CACHE_STATE_CLIENT) private readonly stateRedis: Redis,
    ) {}

    /**
     * NestJS lifecycle hook called when the application is shutting down.
     * Closes the active Redis client connection pool gracefully.
     */
    async onApplicationShutdown() {
        await Promise.all([this.cacheRedis.quit(), this.stateRedis.quit()]);
    }
}
