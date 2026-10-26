/**
 * @file rate-limit-tracker-source.ts
 * @description Request sources available to rate-limit trackers.
 */

/**
 * Available request tracker sources.
 */
export enum RateLimitTrackerSource {
    /**
     * Full canonical IP resolved by the HTTP adapter's trusted proxy configuration.
     */
    IP = 'ip',

    /**
     * Validated email body field or resource ID route parameter, independent of account existence.
     */
    TARGET_ACCOUNT = 'target-account',

    /**
     * Verified caller ID published after authentication and session admission.
     */
    PRINCIPAL = 'principal',
}
