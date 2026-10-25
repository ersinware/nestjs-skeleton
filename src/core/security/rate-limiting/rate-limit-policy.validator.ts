/**
 * @file rate-limit-policy.validator.ts
 * @description Validates rate-limit policies and endpoint declarations at application bootstrap.
 */

import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { isPublicAuthPolicy } from 'src/core/security/auth';
import { KEY_DECORATOR_RATE_LIMIT_EXEMPT } from 'src/core/security/rate-limiting/decorator/rate-limit-exempt.decorator';
import { KEY_DECORATOR_RATE_LIMIT } from 'src/core/security/rate-limiting/decorator/rate-limit.decorator';
import {
    RATE_LIMIT_POLICIES,
    RateLimitPolicy,
    type RateLimiterDefinition,
} from 'src/core/security/rate-limiting/rate-limit-policy';
import {
    TOKEN_RATE_LIMIT_TRACKER_RESOLVER_REGISTRY,
    type RateLimitTrackerResolverRegistry,
} from 'src/core/security/rate-limiting/rate-limit-tracker-resolver-registry';
import { RateLimitTrackerSource } from 'src/core/security/rate-limiting/rate-limit-tracker-source';
import { SystemException } from 'src/shared/exception';

/**
 * Validates registered handlers using the same discovery pattern as auth policy validation.
 */
@Injectable()
export class RateLimitPolicyValidator implements OnApplicationBootstrap {
    /**
     * Connects endpoint discovery and policy metadata to the configured tracker resolvers.
     *
     * @param discovery Enumerates registered controllers.
     * @param scanner Enumerates inherited controller handlers.
     * @param reflector Reads policy metadata.
     * @param trackerResolverRegistry Module-composed tracker resolver instances for source availability validation.
     */
    constructor(
        private readonly discovery: DiscoveryService,
        private readonly scanner: MetadataScanner,
        private readonly reflector: Reflector,
        @Inject(TOKEN_RATE_LIMIT_TRACKER_RESOLVER_REGISTRY)
        private readonly trackerResolverRegistry: RateLimitTrackerResolverRegistry,
    ) {}

    /**
     * Rejects invalid configuration and incomplete endpoint declarations before listening.
     *
     * @throws {SystemException} When catalog values or endpoint policies are invalid.
     */
    onApplicationBootstrap() {
        for (const policy of Object.values(RateLimitPolicy)) {
            const limiters: readonly RateLimiterDefinition[] = RATE_LIMIT_POLICIES[policy];
            if (limiters.length === 0) {
                throw new SystemException(`Rate-limit policy has no limiters: ${policy}`, {
                    context: {
                        class: RateLimitPolicyValidator.name,
                        method: this.onApplicationBootstrap.name,
                        policy,
                    },
                });
            }

            const names = new Set<string>();
            for (const limiter of limiters) {
                const resolver = this.trackerResolverRegistry[limiter.source];
                if (
                    names.has(limiter.name) ||
                    !Number.isSafeInteger(limiter.limit) ||
                    limiter.limit <= 0 ||
                    limiter.limit >= Number.MAX_SAFE_INTEGER ||
                    !Number.isSafeInteger(limiter.windowSeconds * 1000) ||
                    limiter.windowSeconds <= 0 ||
                    // Sliding Window Counter retains each Redis counter for two windows in milliseconds.
                    limiter.windowSeconds * 1000 * 2 > Number.MAX_SAFE_INTEGER ||
                    !Number.isSafeInteger(limiter.blockDurationSeconds * 1000) ||
                    limiter.blockDurationSeconds <= 0 ||
                    !resolver
                ) {
                    throw new SystemException(`Invalid rate-limit configuration: ${policy}.${limiter.name}`, {
                        context: {
                            class: RateLimitPolicyValidator.name,
                            method: this.onApplicationBootstrap.name,
                            policy,
                            limiter: limiter.name,
                            source: limiter.source,
                        },
                    });
                }

                names.add(limiter.name);
            }
        }

        for (const wrapper of this.discovery.getControllers()) {
            const controller = wrapper.metatype;
            if (!controller) {
                continue;
            }

            if (
                this.reflector.get(KEY_DECORATOR_RATE_LIMIT, controller) !== undefined ||
                this.reflector.get(KEY_DECORATOR_RATE_LIMIT_EXEMPT, controller) !== undefined
            ) {
                throw new SystemException(`Rate-limit policies must be declared on endpoints: ${controller.name}`, {
                    context: {
                        class: RateLimitPolicyValidator.name,
                        method: this.onApplicationBootstrap.name,
                        controller: controller.name,
                    },
                });
            }

            const prototype = controller.prototype as Record<string, (...args: never[]) => unknown>;
            for (const method of this.scanner.getAllMethodNames(prototype)) {
                const handler = prototype[method];
                if (handler && this.reflector.get<number | undefined>(METHOD_METADATA, handler) !== undefined) {
                    this.validateEndpoint(controller, handler);
                }
            }
        }
    }

    /**
     * Validates an explicit endpoint declaration before requests are served.
     *
     * @param controller Controller owning the endpoint.
     * @param handler Endpoint handler.
     * @throws {SystemException} When metadata is missing, conflicting or invalid.
     */
    private validateEndpoint(controller: Parameters<Reflector['get']>[1], handler: Parameters<Reflector['get']>[1]) {
        const policy = this.reflector.get<RateLimitPolicy | undefined>(KEY_DECORATOR_RATE_LIMIT, handler),
            exempt = this.reflector.get<boolean | undefined>(KEY_DECORATOR_RATE_LIMIT_EXEMPT, handler);

        if (exempt === true && policy === undefined) {
            return;
        }

        if (exempt !== undefined || policy === undefined || !Object.values(RateLimitPolicy).includes(policy)) {
            throw new SystemException(`Missing or conflicting rate-limit policy: ${handler.name}`, {
                context: {
                    class: RateLimitPolicyValidator.name,
                    method: this.validateEndpoint.name,
                    handler: handler.name,
                },
            });
        }

        if (
            RATE_LIMIT_POLICIES[policy].some((limiter) => limiter.source === RateLimitTrackerSource.PRINCIPAL) &&
            isPublicAuthPolicy(this.reflector, controller, handler)
        ) {
            throw new SystemException(
                `Public endpoint cannot use a principal rate-limit policy: ${controller.name}.${handler.name}`,
                {
                    context: {
                        class: RateLimitPolicyValidator.name,
                        method: this.validateEndpoint.name,
                        controller: controller.name,
                        handler: handler.name,
                        policy,
                    },
                },
            );
        }
    }
}
