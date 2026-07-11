/**
 * @file fail-safe-throttler.guard.ts
 * @description Custom rate-limiting guard that extends NestJS ThrottlerGuard to provide fail-safe execution.
 * If the rate-limiting storage layer (such as Redis) is down, the guard fails open
 * instead of throwing a 500 error, ensuring system availability.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerException, ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
import { ENV, Environment } from 'src/core/config';
import {
    LogPayload,
    TOKEN_EXCEPTION_TRACKER_PORT,
    TOKEN_LOGGER_PORT,
    type IExceptionTrackerPort,
    type ILoggerPort,
} from 'src/core/observability';
import { KEY_DECORATOR_CRITICAL_THROTTLE } from 'src/core/security/throttle/decorator/critical-throttle.decorator';
import { ThrottlerName } from 'src/core/security/throttle/enum/throttler-name.enum';

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
     * @param loggerPort Injected logger service.
     */
    constructor(
        options: ThrottlerModuleOptions,
        storageService: ThrottlerStorage,
        reflector: Reflector,
        private readonly configService: ConfigService,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
        @Inject(TOKEN_EXCEPTION_TRACKER_PORT) private readonly exceptionTrackerPort: IExceptionTrackerPort,
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

            const _error = error instanceof Error ? error : new Error(String(error));

            this.loggerPort.error(this.createLogPayload(_error));
            this.exceptionTrackerPort.captureException(_error);

            return true;
        }
    }

    /**
     * Creates a standardized log payload for the fail-safe throttler guard.
     */
    private createLogPayload(error: Error): LogPayload {
        return new LogPayload({
            class: this.constructor.name,
            method: this.handleRequest.name,
            error,
        });
    }
}
