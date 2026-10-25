/**
 * @file module.ts
 * @description Owns rate-limit storage lifecycle, active catalog and admission providers.
 */

import { Inject, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import type { RedisClientType } from 'redis';
import { ENV } from 'src/core/config';
import { LoggerModule, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { createNodeRedisClient } from 'src/core/redis';
import { IpTrackerResolverAdapter } from 'src/core/security/rate-limiting/adapter/ip-tracker-resolver.adapter';
import { PrincipalTrackerResolverAdapter } from 'src/core/security/rate-limiting/adapter/principal-tracker-resolver.adapter';
import { RateLimitCounterAdapter } from 'src/core/security/rate-limiting/adapter/rate-limit-counter.adapter';
import { RateLimitHealthAdapter } from 'src/core/security/rate-limiting/adapter/rate-limit-health.adapter';
import { TargetAccountTrackerResolverAdapter } from 'src/core/security/rate-limiting/adapter/target-account-tracker-resolver.adapter';
import { PostAuthRateLimitGuard } from 'src/core/security/rate-limiting/guard/post-auth-rate-limit.guard';
import { PreAuthRateLimitGuard } from 'src/core/security/rate-limiting/guard/pre-auth-rate-limit.guard';
import { TOKEN_RATE_LIMIT_COUNTER_PORT } from 'src/core/security/rate-limiting/port/rate-limit-counter.port';
import { TOKEN_RATE_LIMIT_HEALTH_PORT } from 'src/core/security/rate-limiting/port/rate-limit-health.port';
import { TOKEN_RATE_LIMIT_CONNECTION } from 'src/core/security/rate-limiting/rate-limit-connection.token';
import { RateLimitPolicyValidator } from 'src/core/security/rate-limiting/rate-limit-policy.validator';
import { RateLimitStageRunner } from 'src/core/security/rate-limiting/rate-limit-stage.runner';
import {
    TOKEN_RATE_LIMIT_TRACKER_RESOLVER_REGISTRY,
    type RateLimitTrackerResolverRegistry,
} from 'src/core/security/rate-limiting/rate-limit-tracker-resolver-registry';
import { RateLimitTrackerSource } from 'src/core/security/rate-limiting/rate-limit-tracker-source';

/**
 * Connects in the background at bootstrap, so dependency outages do not freeze process startup.
 * Preview Swagger generation does not bootstrap or connect this provider.
 */
@Module({
    imports: [DiscoveryModule, LoggerModule],
    providers: [
        {
            provide: TOKEN_RATE_LIMIT_CONNECTION,
            inject: [ConfigService, TOKEN_LOGGER_PORT],
            useFactory: (configService: ConfigService, logger: ILoggerPort) =>
                createNodeRedisClient(
                    configService,
                    logger,
                    {
                        host: ENV.REDIS_RATE_LIMIT_HOST,
                        port: ENV.REDIS_RATE_LIMIT_PORT,
                        password: ENV.REDIS_RATE_LIMIT_PASSWORD,
                        tls: ENV.REDIS_RATE_LIMIT_TLS,
                        connectTimeout: ENV.REDIS_RATE_LIMIT_CONNECT_TIMEOUT,
                    },
                    TOKEN_RATE_LIMIT_CONNECTION,
                ),
        },
        { provide: TOKEN_RATE_LIMIT_COUNTER_PORT, useClass: RateLimitCounterAdapter },
        { provide: TOKEN_RATE_LIMIT_HEALTH_PORT, useClass: RateLimitHealthAdapter },
        IpTrackerResolverAdapter,
        TargetAccountTrackerResolverAdapter,
        PrincipalTrackerResolverAdapter,
        {
            provide: TOKEN_RATE_LIMIT_TRACKER_RESOLVER_REGISTRY,
            inject: [IpTrackerResolverAdapter, TargetAccountTrackerResolverAdapter, PrincipalTrackerResolverAdapter],
            useFactory: (
                ipTrackerResolver: IpTrackerResolverAdapter,
                targetAccountTrackerResolver: TargetAccountTrackerResolverAdapter,
                principalTrackerResolver: PrincipalTrackerResolverAdapter,
            ): RateLimitTrackerResolverRegistry => ({
                [RateLimitTrackerSource.IP]: ipTrackerResolver,
                [RateLimitTrackerSource.TARGET_ACCOUNT]: targetAccountTrackerResolver,
                [RateLimitTrackerSource.PRINCIPAL]: principalTrackerResolver,
            }),
        },
        RateLimitPolicyValidator,
        RateLimitStageRunner,
        PreAuthRateLimitGuard,
        PostAuthRateLimitGuard,
    ],
    exports: [PreAuthRateLimitGuard, PostAuthRateLimitGuard, TOKEN_RATE_LIMIT_HEALTH_PORT],
})
export class RateLimitingModule implements OnApplicationBootstrap, OnApplicationShutdown {
    /**
     * Retains the rate-limit Redis connection for startup and shutdown.
     *
     * @param redis Concern-owned connection; no cache/session clients are reused.
     */
    constructor(@Inject(TOKEN_RATE_LIMIT_CONNECTION) private readonly redis: RedisClientType) {}

    /**
     * Starts background connection/reconnection without blocking startup on dependency availability.
     */
    onApplicationBootstrap() {
        // node-redis emits connection errors to the factory's episode logger; reconnect remains active.
        void this.redis.connect().catch(() => {});
    }

    /**
     * Discards pending work and terminates reconnect promptly instead of waiting for a dead socket.
     */
    onApplicationShutdown() {
        if (this.redis.isOpen) {
            this.redis.destroy();
        }
    }
}
