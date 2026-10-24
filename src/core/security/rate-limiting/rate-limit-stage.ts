/**
 * @file rate-limit-stage.ts
 * @description Rate-limit execution stages relative to authentication.
 */

/**
 * Guard stages on either side of authentication.
 */
export enum RateLimitStage {
    /**
     * Before authentication performs credential work.
     */
    PRE_AUTH = 'pre-auth',

    /**
     * After authentication publishes verified identity.
     */
    POST_AUTH = 'post-auth',
}
