/**
 * @file rate-limit-stage.runner.ts
 * @description Sequential admission of policy counters in a guard stage.
 */

import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ENV } from 'src/core/config';
import { KEY_DECORATOR_RATE_LIMIT_EXEMPT } from 'src/core/security/rate-limiting/decorator/rate-limit-exempt.decorator';
import { KEY_DECORATOR_RATE_LIMIT } from 'src/core/security/rate-limiting/decorator/rate-limit.decorator';
import {
    TOKEN_RATE_LIMIT_COUNTER_PORT,
    type IRateLimitCounterPort,
} from 'src/core/security/rate-limiting/port/rate-limit-counter.port';
import {
    RATE_LIMIT_POLICIES,
    RateLimitPolicy,
    type RateLimiterDefinition,
} from 'src/core/security/rate-limiting/rate-limit-policy';
import { RateLimitStage } from 'src/core/security/rate-limiting/rate-limit-stage';
import {
    TOKEN_RATE_LIMIT_TRACKER_RESOLVER_REGISTRY,
    type RateLimitTrackerResolverRegistry,
} from 'src/core/security/rate-limiting/rate-limit-tracker-resolver-registry';
import { RateLimitedException, SystemException } from 'src/shared/exception';

/**
 * Applies policy-declared axes only; authentication and authorization remain separate guards.
 */
@Injectable()
export class RateLimitStageRunner {
    /**
     * Service identity shared by instances using the same rate-limit counters.
     */
    private readonly serviceName: string;

    /**
     * Connects policy execution to tracker resolution, counter storage and service namespacing.
     *
     * @param reflector Reads endpoint declarations already validated at bootstrap.
     * @param trackerResolverRegistry Module-composed tracker resolver instances.
     * @param counter Atomic counter admission port.
     * @param configService Validated service namespace configuration.
     */
    constructor(
        private readonly reflector: Reflector,
        @Inject(TOKEN_RATE_LIMIT_TRACKER_RESOLVER_REGISTRY)
        private readonly trackerResolverRegistry: RateLimitTrackerResolverRegistry,
        @Inject(TOKEN_RATE_LIMIT_COUNTER_PORT) private readonly counter: IRateLimitCounterPort,
        configService: ConfigService,
    ) {
        this.serviceName = configService.getOrThrow<string>(ENV.SERVICE_NAME);
    }

    /**
     * Checks applicable counters in declaration order, stopping at the first refusal or failure.
     *
     * @param context Current endpoint and HTTP request.
     * @param stage Position relative to authentication.
     * @returns True when all applicable counters admit the request.
     * @throws {RateLimitedException} When the first blocking counter refuses admission.
     * @throws {DependencyUnavailableException} When required storage is unavailable or a Redis command times out.
     * @throws {InvalidInputException} When a configured client tracker source is invalid.
     * @throws {SystemException} When server-established tracker data is invalid.
     */
    async run(context: ExecutionContext, stage: RateLimitStage): Promise<boolean> {
        const handler = context.getHandler();
        if (this.reflector.get<boolean>(KEY_DECORATOR_RATE_LIMIT_EXEMPT, handler)) {
            return true;
        }

        const policy = this.reflector.get<RateLimitPolicy>(KEY_DECORATOR_RATE_LIMIT, handler),
            limiters: readonly RateLimiterDefinition[] = RATE_LIMIT_POLICIES[policy].filter(
                (limiter) => limiter.stage === stage,
            );

        if (limiters.length === 0) {
            return true;
        }

        const request = context.switchToHttp().getRequest<FastifyRequest>();

        for (const limiter of limiters) {
            const tracker = this.trackerResolverRegistry[limiter.source].resolve(request, limiter.field);
            if (!tracker) {
                throw new SystemException('Rate-limit resolver produced an invalid tracker.', {
                    context: {
                        class: RateLimitStageRunner.name,
                        method: this.run.name,
                        policy,
                        limiterName: limiter.name,
                        source: limiter.source,
                        stage,
                    },
                });
            }

            const result = await this.counter.consume({
                key: `${this.serviceName}:rl:${policy}:${limiter.name}:${tracker}`,
                limiterName: limiter.name,
                limit: limiter.limit,
                windowSeconds: limiter.windowSeconds,
                blockDurationSeconds: limiter.blockDurationSeconds,
            });

            if (!result.allowed) {
                throw new RateLimitedException(result.retryAfterSeconds);
            }
        }

        return true;
    }
}
