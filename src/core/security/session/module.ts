/**
 * @file module.ts
 * @description NestJS module owning the state (session store) Redis connection and the session ports.
 * Manages the connection and handles graceful shutdowns by closing the active client connection.
 */

import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createRedisClient } from 'src/core/cache';
import { ENV } from 'src/core/config';
import { LoggerModule, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { SessionAdapter } from 'src/core/security/session/adapter/session.adapter';
import { StateCleanerAdapter } from 'src/core/security/session/adapter/state-cleaner.adapter';
import { StateHealthAdapter } from 'src/core/security/session/adapter/state-health.adapter';
import { TOKEN_SESSION_PORT } from 'src/core/security/session/port/session.port';
import { TOKEN_STATE_CLEANER_PORT } from 'src/core/security/session/port/state-cleaner.port';
import { TOKEN_STATE_HEALTH_PORT } from 'src/core/security/session/port/state-health.port';
import { TOKEN_STATE_CLIENT } from 'src/core/security/session/state-client.token';

/**
 * Module responsible for configuring and exposing session management capabilities on the state store.
 */
@Module({
    imports: [LoggerModule],
    providers: [
        {
            inject: [ConfigService, TOKEN_LOGGER_PORT],
            provide: TOKEN_STATE_CLIENT,
            useFactory: (config: ConfigService, logger: ILoggerPort) =>
                createRedisClient(
                    config,
                    logger,
                    {
                        host: ENV.REDIS_STATE_HOST,
                        port: ENV.REDIS_STATE_PORT,
                        password: ENV.REDIS_STATE_PASSWORD,
                        tls: ENV.REDIS_STATE_TLS,
                    },
                    TOKEN_STATE_CLIENT,
                ),
        },
        {
            provide: TOKEN_SESSION_PORT,
            useClass: SessionAdapter,
        },
        {
            provide: TOKEN_STATE_CLEANER_PORT,
            useClass: StateCleanerAdapter,
        },
        {
            provide: TOKEN_STATE_HEALTH_PORT,
            useClass: StateHealthAdapter,
        },
    ],
    exports: [TOKEN_SESSION_PORT, TOKEN_STATE_CLEANER_PORT, TOKEN_STATE_HEALTH_PORT],
})
export class SessionModule implements OnApplicationShutdown {
    /**
     * Creates an instance of SessionModule.
     *
     * @param stateRedis The injected state Redis client instance.
     */
    constructor(@Inject(TOKEN_STATE_CLIENT) private readonly stateRedis: Redis) {}

    /**
     * NestJS lifecycle hook called when the application is shutting down.
     * Closes the active Redis client connection gracefully.
     */
    async onApplicationShutdown() {
        await this.stateRedis.quit();
    }
}
