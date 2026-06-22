/**
 * @file fail-safe-throttler.guard.ts
 * @description Custom rate-limiting guard that extends NestJS ThrottlerGuard to provide fail-safe execution.
 * If the rate-limiting storage layer (such as Redis) is down, the guard fails open
 * instead of throwing a 500 error, ensuring system availability.
 */

import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ENV } from 'src/common/config/constant/env.constant';
import { Environment } from 'src/common/enum/config/environment.enum';
import { ThrottlerGuard, ThrottlerRequest, ThrottlerException } from '@nestjs/throttler';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import * as Sentry from '@sentry/nestjs';
import { LogPayload } from 'src/common/logger/log-payload';

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
     * @param logger Injected logger service.
     */
    constructor(
        options: ThrottlerModuleOptions,
        storageService: ThrottlerStorage,
        reflector: Reflector,
        private readonly configService: ConfigService,
        private readonly logger: Logger,
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
        if (this.configService.get<Environment>(ENV.NODE_ENV) === Environment.TEST) {
            // Bypass rate-limiting in test/CI environments, E2E tests, and automated fuzzing (Schemathesis)
            // to avoid hitting rate-limiting thresholds and causing false failures during test executions.
            return true;
        }

        try {
            return await super.handleRequest(request);
        } catch (error) {
            if (error instanceof ThrottlerException) {
                throw error;
            }

            const _error = error instanceof Error ? error : new Error(String(error));

            this.logger.error(
                new LogPayload({
                    class: this.constructor.name,
                    method: this.handleRequest.name,
                    error: _error,
                }),
            );
            Sentry.captureException(_error);

            return true;
        }
    }
}
