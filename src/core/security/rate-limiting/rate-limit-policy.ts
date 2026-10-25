/**
 * @file rate-limit-policy.ts
 * @description Complete active rate-limit policies with ordered counters and numeric budgets.
 */

import { RateLimitStage } from 'src/core/security/rate-limiting/rate-limit-stage';
import { RateLimitTrackerSource } from 'src/core/security/rate-limiting/rate-limit-tracker-source';

/**
 * Supported policies with centrally configured limiter sets.
 */
export enum RateLimitPolicy {
    /**
     * Shared IP budget for endpoints without an active special policy.
     */
    DEFAULT = 'default',

    /**
     * Independent user credential-guessing budgets by source IP and target email.
     */
    USER_LOGIN = 'user-login',

    /**
     * Independent admin credential-guessing budgets by source IP and target email.
     */
    ADMIN_LOGIN = 'admin-login',

    /**
     * Independent refresh budget.
     */
    REFRESH_TOKEN = 'refresh-token',

    /**
     * Independent activation resend budgets by source IP and target email.
     */
    USER_ACTIVATION_RESEND = 'user-activation-resend',

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

    /**
     * Short target-account window shared across source IPs.
     */
    TARGET_ACCOUNT_SHORT = 'target-account-short',

    /**
     * Long target-account window shared across source IPs.
     */
    TARGET_ACCOUNT_LONG = 'target-account-long',
}

/**
 * Body properties supported by client-supplied tracker policies.
 */
export enum RateLimitTrackerField {
    /**
     * Target account email supplied in the request body.
     */
    EMAIL = 'email',
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
} & (
    | {
          /**
           * Adapter-resolved request IP.
           */
          readonly source: RateLimitTrackerSource.IP;

          /**
           * Stage at which this counter runs.
           */
          readonly stage: RateLimitStage;

          /**
           * IP trackers do not read a body field.
           */
          readonly field?: never;
      }
    | {
          /**
           * Client-supplied target account.
           */
          readonly source: RateLimitTrackerSource.TARGET_ACCOUNT;

          /**
           * Target-account limits run before authentication.
           */
          readonly stage: RateLimitStage.PRE_AUTH;

          /**
           * Body property containing the target account email.
           */
          readonly field: RateLimitTrackerField;
      }
);

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
    [RateLimitPolicy.USER_LOGIN]: [
        {
            name: RateLimiterName.IP_SHORT,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 60,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },
        {
            name: RateLimiterName.IP_LONG,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 300,
            windowSeconds: 900,
            blockDurationSeconds: 300,
        },
        {
            name: RateLimiterName.TARGET_ACCOUNT_SHORT,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            field: RateLimitTrackerField.EMAIL,
            stage: RateLimitStage.PRE_AUTH,
            limit: 5,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },
        {
            name: RateLimiterName.TARGET_ACCOUNT_LONG,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            field: RateLimitTrackerField.EMAIL,
            stage: RateLimitStage.PRE_AUTH,
            limit: 20,
            windowSeconds: 900,
            blockDurationSeconds: 300,
        },
    ],
    [RateLimitPolicy.ADMIN_LOGIN]: [
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
            windowSeconds: 900,
            blockDurationSeconds: 300,
        },
        {
            name: RateLimiterName.TARGET_ACCOUNT_SHORT,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            field: RateLimitTrackerField.EMAIL,
            stage: RateLimitStage.PRE_AUTH,
            limit: 5,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },
        {
            name: RateLimiterName.TARGET_ACCOUNT_LONG,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            field: RateLimitTrackerField.EMAIL,
            stage: RateLimitStage.PRE_AUTH,
            limit: 10,
            windowSeconds: 900,
            blockDurationSeconds: 300,
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
    [RateLimitPolicy.USER_ACTIVATION_RESEND]: [
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
        {
            name: RateLimiterName.TARGET_ACCOUNT_SHORT,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            field: RateLimitTrackerField.EMAIL,
            stage: RateLimitStage.PRE_AUTH,
            limit: 1,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },
        {
            name: RateLimiterName.TARGET_ACCOUNT_LONG,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            field: RateLimitTrackerField.EMAIL,
            stage: RateLimitStage.PRE_AUTH,
            limit: 5,
            windowSeconds: 3600,
            blockDurationSeconds: 300,
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
