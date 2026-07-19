/**
 * @file fail-safe-throttler.guard.ts
 * @description Custom rate-limiting guard that extends NestJS ThrottlerGuard to provide fail-safe execution.
 * If the rate-limiting storage layer (such as Redis) is down, the guard fails open
 * instead of throwing a 500 error, ensuring system availability.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerException, ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
import { ENV, Environment } from 'src/core/config';
import { KEY_DECORATOR_CRITICAL_THROTTLE } from 'src/core/security/throttle/decorator/critical-throttle.decorator';
import { ThrottlerName } from 'src/core/security/throttle/throttler-name.enum';

/**
 * Custom rate limiting guard that bypasses limits during testing and handles storage failures gracefully.
 */
@Injectable()
export class FailSafeThrottlerGuard extends ThrottlerGuard {
    /**
     * Creates an instance of FailSafeThrottlerGuard.
     *
     * @param options Configured throttler module options.
     * @param storageService Rate-limiting storage provider.
     * @param reflector NestJS Reflector to read route metadata.
     * @param configService Configuration reader service.
     */
    constructor(
        options: ThrottlerModuleOptions,
        storageService: ThrottlerStorage,
        reflector: Reflector,
        private readonly configService: ConfigService,
    ) {
        super(options, storageService, reflector);
    }

    /**
     * Intercepts and handles the rate limit evaluation for the incoming request.
     * Bypasses throttling in the test environment and catches Redis connectivity
     * issues to prevent blocking users when the rate limiting storage goes offline.
     *
     * @param request The object containing request context and metadata.
     * @returns A promise resolving to true if the request is allowed.
     * @throws {ThrottlerException} if the rate limit is exceeded.
     */
    protected override async handleRequest(request: ThrottlerRequest): Promise<boolean> {
        if (this.configService.getOrThrow<Environment>(ENV.NODE_ENV) === Environment.TEST) {
            // Bypass rate-limiting in test/CI environments, E2E tests, and automated fuzzing (Schemathesis)
            // to avoid hitting rate-limiting thresholds and causing false failures during test executions.
            return true;
        }

        const isCritical = this.reflector.getAllAndOverride<boolean>(KEY_DECORATOR_CRITICAL_THROTTLE, [
            request.context.getHandler(),
            request.context.getClass(),
        ]);

        // Prevent multiple global throttlers from running concurrently on the same route.
        // Ensures that only the 'CRITICAL' limit applies to critical routes, and only the 'DEFAULT' limit applies to normal routes.
        if (request.throttler.name !== (isCritical ? ThrottlerName.CRITICAL : ThrottlerName.DEFAULT)) {
            return true;
        }

        try {
            return await super.handleRequest(request);
        } catch (error) {
            if (error instanceof ThrottlerException) {
                throw error;
            }

            // Fail-open: rate limiting degrades gracefully and self-heals when the storage recovers.
            // No log, no Sentry — the storage is the state Redis client, so the outage is already
            // detected by the health alarm and its cause named by the connection-transition log in
            // `core/cache/module.ts`; a per-request record here would only flood during the outage.
            return true;
        }
    }
}
