/**
 * @file fail-safe-throttler.guard.ts
 * @description Custom rate-limiting guard that extends NestJS ThrottlerGuard to provide fail-safe execution.
 * If the rate-limiting storage layer (such as Redis) is down, the guard fails open
 * instead of throwing a 500 error, ensuring system availability.
 */

import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ThrottlerLimitDetail, ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import {
    InjectThrottlerOptions,
    InjectThrottlerStorage,
    ThrottlerException,
    ThrottlerGuard,
    ThrottlerRequest,
} from '@nestjs/throttler';
import { ENV, Environment } from 'src/core/config';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { KEY_DECORATOR_THROTTLE_POLICY } from 'src/core/security/throttle/decorator/throttle-policy.decorator';
import { ThrottlePolicy } from 'src/core/security/throttle/throttle-policy.enum';
import { ThrottlerName } from 'src/core/security/throttle/throttler-name.enum';

/**
 * Which limiters each policy is enforced by, as an exhaustive Record so a new policy cannot be added
 * without deciding what enforces it — the same reason the exception filter maps kinds this way.
 *
 * A policy resolves to a LIST because the windows compose: a critical route is bound by its burst
 * limiter and its sustained limiter at once, and passing requires satisfying both. Limiters not listed
 * for the route's policy are skipped entirely, so a route is never counted against a window that was
 * not chosen for it.
 */
const POLICY_THROTTLERS: Record<ThrottlePolicy, ThrottlerName[]> = {
    [ThrottlePolicy.DEFAULT]: [ThrottlerName.DEFAULT],
    [ThrottlePolicy.CRITICAL]: [ThrottlerName.CRITICAL_BURST, ThrottlerName.CRITICAL_SUSTAINED],
};

/**
 * Custom rate limiting guard that bypasses limits during testing and handles storage failures gracefully.
 */
@Injectable()
export class FailSafeThrottlerGuard extends ThrottlerGuard {
    /**
     * Creates an instance of FailSafeThrottlerGuard.
     *
     * The first two parameters restate the base class's injection tokens rather than inheriting them.
     * Declaring any `@Inject` here writes this class's OWN dependency metadata, which shadows — not
     * extends — the base class's, so omitting them would leave the options and the storage unresolvable
     * at boot the moment a fourth token is added below.
     *
     * @param options Configured throttler module options.
     * @param storageService Rate-limiting storage provider.
     * @param reflector NestJS Reflector to read route metadata.
     * @param configService Configuration reader service.
     * @param auditPort Records the moment a tracker crosses a limit.
     */
    constructor(
        @InjectThrottlerOptions() options: ThrottlerModuleOptions,
        @InjectThrottlerStorage() storageService: ThrottlerStorage,
        reflector: Reflector,
        private readonly configService: ConfigService,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
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

        const policy =
            this.reflector.getAllAndOverride<ThrottlePolicy>(KEY_DECORATOR_THROTTLE_POLICY, [
                request.context.getHandler(),
                request.context.getClass(),
            ]) ?? ThrottlePolicy.DEFAULT;

        // The guard is invoked once per configured limiter, so this is where a route opts out of the
        // limiters its policy did not select — without it, every route would be counted against every
        // window at once.
        if (!POLICY_THROTTLERS[policy].includes(request.throttler.name as ThrottlerName)) {
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

    /**
     * Records the block ONCE, at the request that caused it, then refuses exactly as the base class
     * would.
     *
     * A block is one episode, not one event per refused request: with a 60s block, an attacker at 100
     * rps is refused six thousand times for a single decision. Writing all six thousand would be the
     * per-request flooding the connection-outage rule already rejects for dependencies — and it lands
     * in a store that is exempt from log levels, retained by policy, and destined to become a table,
     * where it would hand any anonymous caller a write amplifier against the evidence trail.
     *
     * Crossing is identified by `totalHits === limit + 1`, which is precisely the hit at which the
     * storage script sets the block key; every later refusal keeps incrementing and so cannot match.
     * The one case this under-records is a re-block while the hit counter is still alive, reachable
     * only if `blockDuration` is configured SHORTER than its `ttl`. Under-recording is the correct
     * direction to err: the alternative floods exactly when the log matters most.
     *
     * The record needs no `reason` — the ambient context already carries the address, the user agent
     * and the route, which is the whole of what a rate-limit refusal establishes.
     *
     * @param context Execution context of the refused request.
     * @param throttlerLimitDetail The limiter's verdict, read for the hit count that crossed the limit.
     * @throws {ThrottlerException} always — refusing is this method's contract.
     */
    protected override async throwThrottlingException(
        context: ExecutionContext,
        throttlerLimitDetail: ThrottlerLimitDetail,
    ): Promise<void> {
        if (throttlerLimitDetail.totalHits === throttlerLimitDetail.limit + 1) {
            this.auditPort.record({ action: AuditAction.RATE_LIMITED });
        }

        await super.throwThrottlingException(context, throttlerLimitDetail);
    }
}
