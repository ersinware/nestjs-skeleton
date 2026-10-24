/**
 * @file module.ts
 * @description NestJS module owning the session store Redis connection and the session ports.
 */

import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ENV } from 'src/core/config';
import { LoggerModule, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { createRedisClient } from 'src/core/redis';
import { SessionCleanerAdapter } from 'src/core/security/session/adapter/session-cleaner.adapter';
import { SessionHealthAdapter } from 'src/core/security/session/adapter/session-health.adapter';
import { SessionAdapter } from 'src/core/security/session/adapter/session.adapter';
import { TOKEN_SESSION_CLEANER_PORT } from 'src/core/security/session/port/session-cleaner.port';
import { TOKEN_SESSION_HEALTH_PORT } from 'src/core/security/session/port/session-health.port';
import { TOKEN_SESSION_PORT } from 'src/core/security/session/port/session.port';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';

/**
 * Provides the session store Redis connection and binds the session, cleaner, and health ports to
 * their adapters. Closes the connection gracefully on shutdown.
 */
@Module({
    imports: [LoggerModule],
    providers: [
        {
            inject: [ConfigService, TOKEN_LOGGER_PORT],
            provide: TOKEN_SESSION_CONNECTION,
            useFactory: (config: ConfigService, logger: ILoggerPort) =>
                createRedisClient(
                    config,
                    logger,
                    {
                        host: ENV.REDIS_SESSION_HOST,
                        port: ENV.REDIS_SESSION_PORT,
                        password: ENV.REDIS_SESSION_PASSWORD,
                        tls: ENV.REDIS_SESSION_TLS,
                        connectTimeout: ENV.REDIS_SESSION_CONNECT_TIMEOUT,
                        maxRetriesPerRequest: ENV.REDIS_SESSION_MAX_RETRIES_PER_REQUEST,
                        commandTimeout: ENV.REDIS_SESSION_COMMAND_TIMEOUT,
                    },
                    TOKEN_SESSION_CONNECTION,
                ),
        },
        {
            provide: TOKEN_SESSION_PORT,
            useClass: SessionAdapter,
        },
        {
            provide: TOKEN_SESSION_CLEANER_PORT,
            useClass: SessionCleanerAdapter,
        },
        {
            provide: TOKEN_SESSION_HEALTH_PORT,
            useClass: SessionHealthAdapter,
        },
    ],
    exports: [TOKEN_SESSION_PORT, TOKEN_SESSION_CLEANER_PORT, TOKEN_SESSION_HEALTH_PORT],
})
export class SessionModule implements OnApplicationShutdown {
    /**
     * @param sessionRedis The session store Redis client.
     */
    constructor(@Inject(TOKEN_SESSION_CONNECTION) private readonly sessionRedis: Redis) {}

    /**
     * Closes the Redis connection on application shutdown.
     */
    async onApplicationShutdown() {
        await this.sessionRedis.quit();
    }
}
