/**
 * @file rate-limit-policy.validator.spec.ts
 * @description Real Nest discovery coverage for mandatory endpoint policies and usable counter configuration.
 */

import { Controller, Get, Scope, type Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import 'reflect-metadata';
import { Authenticated, Public } from 'src/core/security/auth';
import { PrincipalTrackerResolverAdapter } from 'src/core/security/rate-limiting/adapter/principal-tracker-resolver.adapter';
import { TargetAccountTrackerResolverAdapter } from 'src/core/security/rate-limiting/adapter/target-account-tracker-resolver.adapter';
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
 *
 * @param controllers Controllers included in discovery.
 * @param registry Configured tracker resolvers.
 * @throws {SystemException} When policy configuration or endpoint metadata is invalid.
 */
async function bootstrap(
    controllers: readonly Type<unknown>[],
    registry: Partial<RateLimitTrackerResolverRegistry> = {
        ip: { resolve: () => '192.0.2.1' },
        'target-account': new TargetAccountTrackerResolverAdapter(),
        principal: new PrincipalTrackerResolverAdapter(),
    },
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
        /**
         * Provides an inherited route with an explicit policy.
         */
        class BaseController {
            /**
             * Inherited limited endpoint.
             */
            @Get('limited')
            @RateLimit(RateLimitPolicy.DEFAULT)
            limited() {}
        }
        /**
         * Exercises inherited routes, explicit exemptions and request-scoped discovery.
         */
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
        /**
         * Provides an inherited route missing its required policy.
         */
        class BaseController {
            /**
             * Deliberately unprotected route.
             */
            @Get()
            endpoint() {}
        }
        /**
         * Inherits a route without the required rate-limit declaration.
         */
        @Controller('missing')
        class MissingController extends BaseController {}
        await expect(bootstrap([MissingController])).rejects.toThrow('Missing or conflicting rate-limit policy');
    });

    it('rejects conflicting endpoint declarations', async () => {
        /**
         * Declares both a policy and an exemption to exercise bootstrap rejection.
         */
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
        /**
         * Receives forbidden class-level metadata despite a valid endpoint declaration.
         */
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
        /**
         * Supplies an unsupported policy name to exercise bootstrap rejection.
         */
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

    it('rejects missing target-account registration even when IP resolution is available', async () => {
        await expect(bootstrap([], { ip: { resolve: () => '192.0.2.1' } })).rejects.toThrow(
            'Invalid rate-limit configuration',
        );
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

    it('rejects duplicate limiter references within one policy', async () => {
        const limiters = RATE_LIMIT_POLICIES[RateLimitPolicy.DEFAULT];
        const original = limiters[1];
        try {
            Object.assign(limiters, { 1: limiters[0] });
            await expect(bootstrap([])).rejects.toThrow('Invalid rate-limit configuration');
        } finally {
            Object.assign(limiters, { 1: original });
        }
    });

    it.each([
        { source: 'principal' },
        { stage: 'post-auth' },
        { field: 'email' },
        { limit: 601 },
        { windowSeconds: 61 },
        { blockDurationSeconds: 11 },
    ])('rejects conflicting shared budget definitions %j', async (change) => {
        const limiters = RATE_LIMIT_POLICIES[RateLimitPolicy.JOB_QUEUE_MUTATION];
        const original = limiters[0];
        try {
            Object.assign(limiters, { 0: { ...original, ...change } });
            await expect(bootstrap([])).rejects.toThrow('Conflicting shared rate-limit counter');
        } finally {
            Object.assign(limiters, { 0: original });
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
    it.each([
        RateLimitPolicy.CREDENTIAL_CHANGE,
        RateLimitPolicy.ADMIN_INVITATION,
        RateLimitPolicy.ADMIN_REINVITATION,
        RateLimitPolicy.JOB_QUEUE_MUTATION,
        RateLimitPolicy.AVATAR_UPLOAD_INITIATE,
    ])(
        'accepts protected %s and rejects public declarations at either level, including inherited handlers',
        async (policy) => {
            /**
             * Inherited handler for principal policy metadata validation.
             */
            class BaseController {
                /**
                 * Requires authentication before resolving the caller tracker.
                 */
                @Get()
                @RateLimit(policy)
                endpoint() {}
            }
            /**
             * Class protection applies to the inherited endpoint.
             */
            @Controller('protected')
            @Authenticated()
            class ProtectedController extends BaseController {}
            await expect(bootstrap([ProtectedController])).resolves.toBeUndefined();
            /**
             * Class-level public access must not bypass the principal requirement.
             */
            @Controller('public-class')
            @Public()
            class PublicClassController extends BaseController {}
            await expect(bootstrap([PublicClassController])).rejects.toThrow('Public endpoint cannot use a principal');
            /**
             * Handler-level public access is also incompatible with a principal policy.
             */
            @Controller('public-handler')
            class PublicHandlerController {
                /**
                 * Deliberately contradictory public endpoint.
                 */
                @Get()
                @Public()
                @RateLimit(policy)
                endpoint() {}
            }
            await expect(bootstrap([PublicHandlerController])).rejects.toThrow(
                'Public endpoint cannot use a principal',
            );
        },
    );

    it('rejects missing principal registration even when earlier sources are available', async () => {
        await expect(
            bootstrap([], {
                ip: { resolve: () => '192.0.2.1' },
                'target-account': new TargetAccountTrackerResolverAdapter(),
            }),
        ).rejects.toThrow('Invalid rate-limit configuration');
    });
});
