/**
 * @file rate-limit-policy.validator.spec.ts
 * @description Real Nest discovery coverage for mandatory endpoint policies and usable counter configuration.
 */

import { Controller, Get, Scope, type Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import 'reflect-metadata';
import { RateLimitExempt } from 'src/core/security/rate-limiting/decorator/rate-limit-exempt.decorator';
import { RateLimit } from 'src/core/security/rate-limiting/decorator/rate-limit.decorator';
import { RATE_LIMIT_POLICIES, RateLimitPolicy } from 'src/core/security/rate-limiting/rate-limit-policy';
import { RateLimitPolicyValidator } from 'src/core/security/rate-limiting/rate-limit-policy.validator';
import {
    TOKEN_RATE_LIMIT_TRACKER_RESOLVER_REGISTRY,
    type RateLimitTrackerResolverRegistry,
} from 'src/core/security/rate-limiting/rate-limit-tracker-resolver-registry';
import { describe, expect, it } from 'vitest';

/**
 * Boots the production validator with real controller discovery and no network clients.
 * @param controllers Controllers included in discovery.
 * @param registry Configured tracker resolvers.
 * @returns Completion after validation and module disposal.
 */
async function bootstrap(
    controllers: readonly Type<unknown>[],
    registry: Partial<RateLimitTrackerResolverRegistry> = { ip: { resolve: () => '192.0.2.1' } },
): Promise<void> {
    const module = await Test.createTestingModule({
        imports: [DiscoveryModule],
        controllers: [...controllers],
        providers: [
            RateLimitPolicyValidator,
            { provide: TOKEN_RATE_LIMIT_TRACKER_RESOLVER_REGISTRY, useValue: registry },
        ],
    }).compile();
    try {
        await module.init();
    } finally {
        await module.close();
    }
}

describe('RateLimitPolicyValidator bootstrap', () => {
    it('accepts explicit policies, exemptions and inherited routes without constructing scoped controllers', async () => {
        let constructions = 0;
        class BaseController {
            /**
             * Inherited limited endpoint.
             */
            @Get('limited')
            @RateLimit(RateLimitPolicy.DEFAULT)
            limited() {}
        }
        @Controller({ path: 'valid', scope: Scope.REQUEST })
        class ValidController extends BaseController {
            /**
             * Scoped instances are unnecessary for metadata validation.
             */
            constructor() {
                super();
                constructions++;
            }
            /**
             * Operational exemption.
             */
            @Get('exempt')
            @RateLimitExempt()
            exempt() {}
            /**
             * Helpers are not routes.
             */
            helper() {}
        }
        await expect(bootstrap([ValidController])).resolves.toBeUndefined();
        expect(constructions).toBe(0);
    });

    it('rejects a missing policy on an inherited GET', async () => {
        class BaseController {
            /**
             * Deliberately unprotected route.
             */
            @Get()
            endpoint() {}
        }
        @Controller('missing')
        class MissingController extends BaseController {}
        await expect(bootstrap([MissingController])).rejects.toThrow('Missing or conflicting rate-limit policy');
    });

    it('rejects conflicting endpoint declarations', async () => {
        @Controller('conflict')
        class ConflictController {
            /**
             * Cannot select both declarations.
             */
            @Get()
            @RateLimit(RateLimitPolicy.DEFAULT)
            @RateLimitExempt()
            endpoint() {}
        }
        await expect(bootstrap([ConflictController])).rejects.toThrow('Missing or conflicting');
    });

    it('rejects class-level policies even when handlers declare a policy', async () => {
        @Controller('class-policy')
        class ClassPolicyController {
            /**
             * Explicit endpoint policy cannot legalize a class policy.
             */
            @Get()
            @RateLimit(RateLimitPolicy.DEFAULT)
            endpoint() {}
        }
        // Deliberately simulate metadata attached through JavaScript or an unsafe decorator cast.
        RateLimit(RateLimitPolicy.DEFAULT)(ClassPolicyController, undefined as never, undefined as never);
        await expect(bootstrap([ClassPolicyController])).rejects.toThrow('must be declared on endpoints');
    });

    it('rejects an unknown policy name', async () => {
        @Controller('unknown')
        class UnknownController {
            /**
             * Simulates stale or dynamically supplied metadata.
             */
            @Get()
            @RateLimit('unknown' as RateLimitPolicy)
            endpoint() {}
        }
        await expect(bootstrap([UnknownController])).rejects.toThrow('Missing or conflicting');
    });

    it('rejects a configured source without a resolver', async () => {
        await expect(bootstrap([], {})).rejects.toThrow('Invalid rate-limit configuration');
    });

    it.each([
        { limit: 0 },
        { limit: 1.5 },
        { windowSeconds: 0 },
        { windowSeconds: Number.MAX_SAFE_INTEGER / 1000 },
        { blockDurationSeconds: -1 },
    ])('rejects unusable counter values %j', async (invalid) => {
        const limiter = RATE_LIMIT_POLICIES[RateLimitPolicy.DEFAULT][0];
        const original = { ...limiter };
        try {
            Object.assign(limiter, invalid);
            await expect(bootstrap([])).rejects.toThrow('Invalid rate-limit configuration');
        } finally {
            Object.assign(limiter, original);
        }
    });

    it('rejects duplicate limiter names within one policy', async () => {
        const limiter = RATE_LIMIT_POLICIES[RateLimitPolicy.DEFAULT][1];
        const original = { ...limiter };
        try {
            Object.assign(limiter, { name: RATE_LIMIT_POLICIES.default[0].name });
            await expect(bootstrap([])).rejects.toThrow('Invalid rate-limit configuration');
        } finally {
            Object.assign(limiter, original);
        }
    });

    it('rejects an entirely empty policy rather than silently disabling admission', async () => {
        const original = RATE_LIMIT_POLICIES.default;
        try {
            Object.assign(RATE_LIMIT_POLICIES, { default: [] });
            await expect(bootstrap([])).rejects.toThrow('no limiters');
        } finally {
            Object.assign(RATE_LIMIT_POLICIES, { default: original });
        }
    });
});
