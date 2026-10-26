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
     * Independent public user registration budget.
     */
    USER_REGISTRATION = 'user-registration',

    /**
     * Independent public user activation budget.
     */
    USER_ACTIVATION = 'user-activation',

    /**
     * Independent activation resend budgets by source IP and target email.
     */
    USER_ACTIVATION_RESEND = 'user-activation-resend',

    /**
     * Invitation budget shared with re-invitation for the calling administrator.
     */
    ADMIN_INVITATION = 'admin-invitation',

    /**
     * Shared caller invitation budget with additional target-admin limits.
     */
    ADMIN_REINVITATION = 'admin-reinvitation',

    /**
     * Independent public admin activation budget.
     */
    ADMIN_ACTIVATION = 'admin-activation',

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
     * Shared password verification budget for password changes and email-change initiation.
     */
    CREDENTIAL_CHANGE = 'credential-change',

    /**
     * Avatar upload preparation budget for the verified caller.
     */
    AVATAR_UPLOAD_INITIATE = 'avatar-upload-initiate',

    /**
     * Dead-letter mutation budget with the default shared IP counters.
     */
    JOB_QUEUE_MUTATION = 'job-queue-mutation',
}

/**
 * Named budgets shared explicitly across policy declarations.
 */
export enum RateLimitBudget {
    /**
     * Default minute budget by source IP.
     */
    DEFAULT_IP_SHORT = 'default-ip-short',

    /**
     * Default fifteen-minute budget by source IP.
     */
    DEFAULT_IP_LONG = 'default-ip-long',

    /**
     * User registration minute budget by source IP.
     */
    USER_REGISTRATION_IP_SHORT = 'user-registration-ip-short',

    /**
     * User registration hourly budget by source IP.
     */
    USER_REGISTRATION_IP_LONG = 'user-registration-ip-long',

    /**
     * User activation minute budget by source IP.
     */
    USER_ACTIVATION_IP_SHORT = 'user-activation-ip-short',

    /**
     * User activation hourly budget by source IP.
     */
    USER_ACTIVATION_IP_LONG = 'user-activation-ip-long',

    /**
     * User activation resend minute budget by source IP.
     */
    USER_ACTIVATION_RESEND_IP_SHORT = 'user-activation-resend-ip-short',

    /**
     * User activation resend hourly budget by source IP.
     */
    USER_ACTIVATION_RESEND_IP_LONG = 'user-activation-resend-ip-long',

    /**
     * User activation resend minute budget by target email.
     */
    USER_ACTIVATION_RESEND_TARGET_SHORT = 'user-activation-resend-target-short',

    /**
     * User activation resend hourly budget by target email.
     */
    USER_ACTIVATION_RESEND_TARGET_LONG = 'user-activation-resend-target-long',

    /**
     * User activation resend daily budget by target email.
     */
    USER_ACTIVATION_RESEND_TARGET_DAILY = 'user-activation-resend-target-daily',

    /**
     * Admin invitation minute budget by source IP.
     */
    ADMIN_INVITATION_IP_SHORT = 'admin-invitation-ip-short',

    /**
     * Admin invitation fifteen-minute budget by source IP.
     */
    ADMIN_INVITATION_IP_LONG = 'admin-invitation-ip-long',

    /**
     * Admin invitation minute budget by verified caller.
     */
    ADMIN_INVITATION_SHORT = 'admin-invitation-short',

    /**
     * Admin invitation hourly budget by verified caller.
     */
    ADMIN_INVITATION_LONG = 'admin-invitation-long',

    /**
     * Admin reinvitation minute budget by target admin.
     */
    ADMIN_REINVITATION_TARGET_SHORT = 'admin-reinvitation-target-short',

    /**
     * Admin reinvitation hourly budget by target admin.
     */
    ADMIN_REINVITATION_TARGET_LONG = 'admin-reinvitation-target-long',

    /**
     * Admin reinvitation daily budget by target admin.
     */
    ADMIN_REINVITATION_TARGET_DAILY = 'admin-reinvitation-target-daily',

    /**
     * Admin activation minute budget by source IP.
     */
    ADMIN_ACTIVATION_IP_SHORT = 'admin-activation-ip-short',

    /**
     * Admin activation hourly budget by source IP.
     */
    ADMIN_ACTIVATION_IP_LONG = 'admin-activation-ip-long',

    /**
     * User login minute budget by source IP.
     */
    USER_LOGIN_IP_SHORT = 'user-login-ip-short',

    /**
     * User login fifteen-minute budget by source IP.
     */
    USER_LOGIN_IP_LONG = 'user-login-ip-long',

    /**
     * User login minute budget by target email.
     */
    USER_LOGIN_TARGET_SHORT = 'user-login-target-short',

    /**
     * User login fifteen-minute budget by target email.
     */
    USER_LOGIN_TARGET_LONG = 'user-login-target-long',

    /**
     * Admin login minute budget by source IP.
     */
    ADMIN_LOGIN_IP_SHORT = 'admin-login-ip-short',

    /**
     * Admin login fifteen-minute budget by source IP.
     */
    ADMIN_LOGIN_IP_LONG = 'admin-login-ip-long',

    /**
     * Admin login minute budget by target email.
     */
    ADMIN_LOGIN_TARGET_SHORT = 'admin-login-target-short',

    /**
     * Admin login fifteen-minute budget by target email.
     */
    ADMIN_LOGIN_TARGET_LONG = 'admin-login-target-long',

    /**
     * Refresh token minute budget by source IP.
     */
    REFRESH_TOKEN_IP_SHORT = 'refresh-token-ip-short',

    /**
     * Refresh token fifteen-minute budget by source IP.
     */
    REFRESH_TOKEN_IP_LONG = 'refresh-token-ip-long',

    /**
     * Credential change minute budget by source IP.
     */
    CREDENTIAL_CHANGE_IP_SHORT = 'credential-change-ip-short',

    /**
     * Credential change fifteen-minute budget by source IP.
     */
    CREDENTIAL_CHANGE_IP_LONG = 'credential-change-ip-long',

    /**
     * Credential change minute budget by verified caller.
     */
    CREDENTIAL_CHANGE_SHORT = 'credential-change-short',

    /**
     * Credential change fifteen-minute budget by verified caller.
     */
    CREDENTIAL_CHANGE_LONG = 'credential-change-long',

    /**
     * Credential change hourly budget by verified caller.
     */
    CREDENTIAL_CHANGE_HOURLY = 'credential-change-hourly',

    /**
     * Credential change daily budget by verified caller.
     */
    CREDENTIAL_CHANGE_DAILY = 'credential-change-daily',

    /**
     * Avatar upload initiate minute budget by source IP.
     */
    AVATAR_UPLOAD_INITIATE_IP_SHORT = 'avatar-upload-initiate-ip-short',

    /**
     * Avatar upload initiate fifteen-minute budget by source IP.
     */
    AVATAR_UPLOAD_INITIATE_IP_LONG = 'avatar-upload-initiate-ip-long',

    /**
     * Avatar upload initiate minute budget by verified caller.
     */
    AVATAR_UPLOAD_INITIATE_SHORT = 'avatar-upload-initiate-short',

    /**
     * Avatar upload initiate hourly budget by verified caller.
     */
    AVATAR_UPLOAD_INITIATE_LONG = 'avatar-upload-initiate-long',

    /**
     * Job queue mutation minute budget by verified caller.
     */
    JOB_QUEUE_MUTATION_SHORT = 'job-queue-mutation-short',

    /**
     * Job queue mutation fifteen-minute budget by verified caller.
     */
    JOB_QUEUE_MUTATION_LONG = 'job-queue-mutation-long',
}

/**
 * Client-supplied fields supported by target-account tracker policies.
 */
export enum RateLimitTrackerField {
    /**
     * Target account email supplied in the request body.
     */
    TARGET_EMAIL = 'email',

    /**
     * Target account UUID v7 supplied through the shared resource ID route parameter.
     */
    TARGET_ID = 'route-id',
}

/**
 * Policy-owned limiter definition, including its shared budget and tracker contract.
 */
export type RateLimiterDefinition = {
    /**
     * Policy-independent budget shared by limiters using the same tracker.
     */
    readonly budget: RateLimitBudget;

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
          readonly stage: RateLimitStage.PRE_AUTH;

          /**
           * IP trackers do not read a body field.
           */
          readonly field?: never;
      }
    | {
          /**
           * Client-supplied target account email.
           */
          readonly source: RateLimitTrackerSource.TARGET_ACCOUNT;

          /**
           * Target-account limits run before authentication.
           */
          readonly stage: RateLimitStage.PRE_AUTH;

          /**
           * Body property containing the target account email.
           */
          readonly field: RateLimitTrackerField.TARGET_EMAIL;
      }
    | {
          /**
           * Client-supplied target account route identifier.
           */
          readonly source: RateLimitTrackerSource.TARGET_ACCOUNT;

          /**
           * Target route budgets require an authenticated caller.
           */
          readonly stage: RateLimitStage.POST_AUTH;

          /**
           * Selector for the shared resource ID route parameter.
           */
          readonly field: RateLimitTrackerField.TARGET_ID;
      }
    | {
          /**
           * Session-checked caller identity published by authentication.
           */
          readonly source: RateLimitTrackerSource.PRINCIPAL;

          /**
           * Principal limits require successful authentication.
           */
          readonly stage: RateLimitStage.POST_AUTH;

          /**
           * Principal trackers do not read a body field.
           */
          readonly field?: never;
      }
);

/**
 * Minute IP limiter shared by default endpoints and job queue mutations.
 */
const DEFAULT_IP_SHORT_LIMITER = {
    budget: RateLimitBudget.DEFAULT_IP_SHORT,
    source: RateLimitTrackerSource.IP,
    stage: RateLimitStage.PRE_AUTH,
    limit: 600,
    windowSeconds: 60,
    blockDurationSeconds: 10,
} as const satisfies RateLimiterDefinition;

/**
 * Fifteen-minute IP limiter shared by default endpoints and job queue mutations.
 */
const DEFAULT_IP_LONG_LIMITER = {
    budget: RateLimitBudget.DEFAULT_IP_LONG,
    source: RateLimitTrackerSource.IP,
    stage: RateLimitStage.PRE_AUTH,
    limit: 6000,
    windowSeconds: 900,
    blockDurationSeconds: 30,
} as const satisfies RateLimiterDefinition;

/**
 * Minute IP limiter shared by invitations and re-invitations.
 */
const ADMIN_INVITATION_IP_SHORT_LIMITER = {
    budget: RateLimitBudget.ADMIN_INVITATION_IP_SHORT,
    source: RateLimitTrackerSource.IP,
    stage: RateLimitStage.PRE_AUTH,
    limit: 60,
    windowSeconds: 60,
    blockDurationSeconds: 10,
} as const satisfies RateLimiterDefinition;

/**
 * Fifteen-minute IP limiter shared by invitations and re-invitations.
 */
const ADMIN_INVITATION_IP_LONG_LIMITER = {
    budget: RateLimitBudget.ADMIN_INVITATION_IP_LONG,
    source: RateLimitTrackerSource.IP,
    stage: RateLimitStage.PRE_AUTH,
    limit: 300,
    windowSeconds: 900,
    blockDurationSeconds: 30,
} as const satisfies RateLimiterDefinition;

/**
 * Minute caller limiter shared by invitations and re-invitations.
 */
const ADMIN_INVITATION_SHORT_LIMITER = {
    budget: RateLimitBudget.ADMIN_INVITATION_SHORT,
    source: RateLimitTrackerSource.PRINCIPAL,
    stage: RateLimitStage.POST_AUTH,
    limit: 3,
    windowSeconds: 60,
    blockDurationSeconds: 60,
} as const satisfies RateLimiterDefinition;

/**
 * Hourly caller limiter shared by invitations and re-invitations.
 */
const ADMIN_INVITATION_LONG_LIMITER = {
    budget: RateLimitBudget.ADMIN_INVITATION_LONG,
    source: RateLimitTrackerSource.PRINCIPAL,
    stage: RateLimitStage.POST_AUTH,
    limit: 10,
    windowSeconds: 3600,
    blockDurationSeconds: 300,
} as const satisfies RateLimiterDefinition;

/**
 * Complete active policies in counter execution order.
 */
export const RATE_LIMIT_POLICIES = {
    [RateLimitPolicy.DEFAULT]: [DEFAULT_IP_SHORT_LIMITER, DEFAULT_IP_LONG_LIMITER],
    [RateLimitPolicy.USER_REGISTRATION]: [
        {
            budget: RateLimitBudget.USER_REGISTRATION_IP_SHORT,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 20,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },

        {
            budget: RateLimitBudget.USER_REGISTRATION_IP_LONG,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 100,
            windowSeconds: 3600,
            blockDurationSeconds: 300,
        },
    ],
    [RateLimitPolicy.USER_ACTIVATION]: [
        {
            budget: RateLimitBudget.USER_ACTIVATION_IP_SHORT,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 20,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },

        {
            budget: RateLimitBudget.USER_ACTIVATION_IP_LONG,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 100,
            windowSeconds: 3600,
            blockDurationSeconds: 300,
        },
    ],
    [RateLimitPolicy.USER_ACTIVATION_RESEND]: [
        {
            budget: RateLimitBudget.USER_ACTIVATION_RESEND_IP_SHORT,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 20,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },

        {
            budget: RateLimitBudget.USER_ACTIVATION_RESEND_IP_LONG,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 100,
            windowSeconds: 3600,
            blockDurationSeconds: 300,
        },

        {
            budget: RateLimitBudget.USER_ACTIVATION_RESEND_TARGET_SHORT,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            stage: RateLimitStage.PRE_AUTH,
            field: RateLimitTrackerField.TARGET_EMAIL,
            limit: 1,
            windowSeconds: 60,
            blockDurationSeconds: 300,
        },

        {
            budget: RateLimitBudget.USER_ACTIVATION_RESEND_TARGET_LONG,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            stage: RateLimitStage.PRE_AUTH,
            field: RateLimitTrackerField.TARGET_EMAIL,
            limit: 3,
            windowSeconds: 3600,
            blockDurationSeconds: 900,
        },

        {
            budget: RateLimitBudget.USER_ACTIVATION_RESEND_TARGET_DAILY,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            stage: RateLimitStage.PRE_AUTH,
            field: RateLimitTrackerField.TARGET_EMAIL,
            limit: 6,
            windowSeconds: 86400,
            blockDurationSeconds: 1800,
        },
    ],
    [RateLimitPolicy.ADMIN_INVITATION]: [
        ADMIN_INVITATION_IP_SHORT_LIMITER,
        ADMIN_INVITATION_IP_LONG_LIMITER,
        ADMIN_INVITATION_SHORT_LIMITER,
        ADMIN_INVITATION_LONG_LIMITER,
    ],
    [RateLimitPolicy.ADMIN_REINVITATION]: [
        ADMIN_INVITATION_IP_SHORT_LIMITER,
        ADMIN_INVITATION_IP_LONG_LIMITER,
        {
            budget: RateLimitBudget.ADMIN_REINVITATION_TARGET_SHORT,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            stage: RateLimitStage.POST_AUTH,
            field: RateLimitTrackerField.TARGET_ID,
            limit: 1,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },
        {
            budget: RateLimitBudget.ADMIN_REINVITATION_TARGET_LONG,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            stage: RateLimitStage.POST_AUTH,
            field: RateLimitTrackerField.TARGET_ID,
            limit: 3,
            windowSeconds: 3600,
            blockDurationSeconds: 300,
        },
        {
            budget: RateLimitBudget.ADMIN_REINVITATION_TARGET_DAILY,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            stage: RateLimitStage.POST_AUTH,
            field: RateLimitTrackerField.TARGET_ID,
            limit: 6,
            windowSeconds: 86400,
            blockDurationSeconds: 1800,
        },

        ADMIN_INVITATION_SHORT_LIMITER,

        ADMIN_INVITATION_LONG_LIMITER,
    ],
    [RateLimitPolicy.ADMIN_ACTIVATION]: [
        {
            budget: RateLimitBudget.ADMIN_ACTIVATION_IP_SHORT,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 20,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },
        {
            budget: RateLimitBudget.ADMIN_ACTIVATION_IP_LONG,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 100,
            windowSeconds: 3600,
            blockDurationSeconds: 300,
        },
    ],
    [RateLimitPolicy.USER_LOGIN]: [
        {
            budget: RateLimitBudget.USER_LOGIN_IP_SHORT,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 60,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },
        {
            budget: RateLimitBudget.USER_LOGIN_IP_LONG,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 300,
            windowSeconds: 900,
            blockDurationSeconds: 300,
        },
        {
            budget: RateLimitBudget.USER_LOGIN_TARGET_SHORT,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            stage: RateLimitStage.PRE_AUTH,
            field: RateLimitTrackerField.TARGET_EMAIL,
            limit: 3,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },
        {
            budget: RateLimitBudget.USER_LOGIN_TARGET_LONG,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            stage: RateLimitStage.PRE_AUTH,
            field: RateLimitTrackerField.TARGET_EMAIL,
            limit: 5,
            windowSeconds: 900,
            blockDurationSeconds: 300,
        },
    ],
    [RateLimitPolicy.ADMIN_LOGIN]: [
        {
            budget: RateLimitBudget.ADMIN_LOGIN_IP_SHORT,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 20,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },
        {
            budget: RateLimitBudget.ADMIN_LOGIN_IP_LONG,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 100,
            windowSeconds: 900,
            blockDurationSeconds: 300,
        },
        {
            budget: RateLimitBudget.ADMIN_LOGIN_TARGET_SHORT,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            stage: RateLimitStage.PRE_AUTH,
            field: RateLimitTrackerField.TARGET_EMAIL,
            limit: 3,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },
        {
            budget: RateLimitBudget.ADMIN_LOGIN_TARGET_LONG,
            source: RateLimitTrackerSource.TARGET_ACCOUNT,
            stage: RateLimitStage.PRE_AUTH,
            field: RateLimitTrackerField.TARGET_EMAIL,
            limit: 5,
            windowSeconds: 900,
            blockDurationSeconds: 300,
        },
    ],
    [RateLimitPolicy.REFRESH_TOKEN]: [
        {
            budget: RateLimitBudget.REFRESH_TOKEN_IP_SHORT,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 300,
            windowSeconds: 60,
            blockDurationSeconds: 10,
        },
        {
            budget: RateLimitBudget.REFRESH_TOKEN_IP_LONG,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 3000,
            windowSeconds: 900,
            blockDurationSeconds: 30,
        },
    ],
    [RateLimitPolicy.CREDENTIAL_CHANGE]: [
        {
            budget: RateLimitBudget.CREDENTIAL_CHANGE_IP_SHORT,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 60,
            windowSeconds: 60,
            blockDurationSeconds: 10,
        },
        {
            budget: RateLimitBudget.CREDENTIAL_CHANGE_IP_LONG,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 300,
            windowSeconds: 900,
            blockDurationSeconds: 30,
        },
        {
            budget: RateLimitBudget.CREDENTIAL_CHANGE_SHORT,
            source: RateLimitTrackerSource.PRINCIPAL,
            stage: RateLimitStage.POST_AUTH,
            limit: 3,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },
        {
            budget: RateLimitBudget.CREDENTIAL_CHANGE_LONG,
            source: RateLimitTrackerSource.PRINCIPAL,
            stage: RateLimitStage.POST_AUTH,
            limit: 5,
            windowSeconds: 900,
            blockDurationSeconds: 300,
        },
        {
            budget: RateLimitBudget.CREDENTIAL_CHANGE_HOURLY,
            source: RateLimitTrackerSource.PRINCIPAL,
            stage: RateLimitStage.POST_AUTH,
            limit: 7,
            windowSeconds: 3600,
            blockDurationSeconds: 900,
        },
        {
            budget: RateLimitBudget.CREDENTIAL_CHANGE_DAILY,
            source: RateLimitTrackerSource.PRINCIPAL,
            stage: RateLimitStage.POST_AUTH,
            limit: 10,
            windowSeconds: 86400,
            blockDurationSeconds: 1800,
        },
    ],
    [RateLimitPolicy.AVATAR_UPLOAD_INITIATE]: [
        {
            budget: RateLimitBudget.AVATAR_UPLOAD_INITIATE_IP_SHORT,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 60,
            windowSeconds: 60,
            blockDurationSeconds: 10,
        },
        {
            budget: RateLimitBudget.AVATAR_UPLOAD_INITIATE_IP_LONG,
            source: RateLimitTrackerSource.IP,
            stage: RateLimitStage.PRE_AUTH,
            limit: 300,
            windowSeconds: 900,
            blockDurationSeconds: 30,
        },
        {
            budget: RateLimitBudget.AVATAR_UPLOAD_INITIATE_SHORT,
            source: RateLimitTrackerSource.PRINCIPAL,
            stage: RateLimitStage.POST_AUTH,
            limit: 3,
            windowSeconds: 60,
            blockDurationSeconds: 60,
        },
        {
            budget: RateLimitBudget.AVATAR_UPLOAD_INITIATE_LONG,
            source: RateLimitTrackerSource.PRINCIPAL,
            stage: RateLimitStage.POST_AUTH,
            limit: 10,
            windowSeconds: 3600,
            blockDurationSeconds: 300,
        },
    ],
    [RateLimitPolicy.JOB_QUEUE_MUTATION]: [
        DEFAULT_IP_SHORT_LIMITER,
        DEFAULT_IP_LONG_LIMITER,
        {
            budget: RateLimitBudget.JOB_QUEUE_MUTATION_SHORT,
            source: RateLimitTrackerSource.PRINCIPAL,
            stage: RateLimitStage.POST_AUTH,
            limit: 3,
            windowSeconds: 60,
            blockDurationSeconds: 30,
        },
        {
            budget: RateLimitBudget.JOB_QUEUE_MUTATION_LONG,
            source: RateLimitTrackerSource.PRINCIPAL,
            stage: RateLimitStage.POST_AUTH,
            limit: 10,
            windowSeconds: 900,
            blockDurationSeconds: 60,
        },
    ],
} as const satisfies Readonly<Record<RateLimitPolicy, readonly RateLimiterDefinition[]>>;
