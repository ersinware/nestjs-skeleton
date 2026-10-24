/**
 * @file rate-limit-policy.ts
 * @description Complete active rate-limit policies with ordered counters and numeric budgets.
 */

import { RateLimitStage } from 'src/core/security/rate-limiting/rate-limit-stage';
import { RateLimitTrackerSource } from 'src/core/security/rate-limiting/rate-limit-tracker-source';

/**
 * Policies whose complete limiter sets are available in this delivery phase.
 */
export enum RateLimitPolicy {
    /**
     * Shared IP budget for endpoints without an active special policy.
     */
    DEFAULT = 'default',

    /**
     * Independent refresh budget.
     */
    REFRESH_TOKEN = 'refresh-token',

    /**
     * Shared registration and activation workflow budget.
     */
    USER_REGISTRATION_ADMIN_USER_ACTIVATION = 'user-registration-admin-user-activation',
}

/**
 * Stable counter names shared across policy declarations and storage.
 */
export enum RateLimiterName {
    /**
     * Short IP window.
     */
    IP_SHORT = 'ip-short',

    /**
     * Long IP window.
     */
    IP_LONG = 'ip-long',
}

/**
 * Complete counter declaration within a policy, including its request budget.
 */
export type RateLimiterDefinition = {
    /**
     * Counter identity, stable across numeric budget changes.
     */
    readonly name: RateLimiterName;

    /**
     * Point at which its request input is authoritative.
     */
    readonly stage: RateLimitStage;

    /**
     * Resolver responsible for producing its tracker.
     */
    readonly source: RateLimitTrackerSource;

    /**
     * Maximum weighted request count.
     */
    readonly limit: number;

    /**
     * Sliding window length in seconds.
     */
    readonly windowSeconds: number;

    /**
     * Fixed block duration in seconds.
     */
    readonly blockDurationSeconds: number;
};

/**
 * Complete active policies in counter execution order; changes require a build and deployment.
 */
export const RATE_LIMIT_POLICIES = {
    [RateLimitPolicy.DEFAULT]: [
        {
            name: RateLimiterName.IP_SHORT,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 600,
            windowSeconds: 60,
            blockDurationSeconds: 10,
        },
        {
            name: RateLimiterName.IP_LONG,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 6000,
            windowSeconds: 900,
            blockDurationSeconds: 30,
        },
    ],
    [RateLimitPolicy.REFRESH_TOKEN]: [
        {
            name: RateLimiterName.IP_SHORT,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 300,
            windowSeconds: 60,
            blockDurationSeconds: 10,
        },
        {
            name: RateLimiterName.IP_LONG,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 3000,
            windowSeconds: 900,
            blockDurationSeconds: 30,
        },
    ],
    [RateLimitPolicy.USER_REGISTRATION_ADMIN_USER_ACTIVATION]: [
        {
            name: RateLimiterName.IP_SHORT,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 20,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },
        {
            name: RateLimiterName.IP_LONG,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 100,
            windowSeconds: 3600,
            blockDurationSeconds: 300,
        },
    ],
} as const satisfies Readonly<Record<RateLimitPolicy, readonly RateLimiterDefinition[]>>;
