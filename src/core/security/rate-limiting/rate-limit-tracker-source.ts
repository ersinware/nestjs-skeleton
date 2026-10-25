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
     * Normalized email supplied in a configured body field, independent of account existence.
     */
    TARGET_ACCOUNT = 'target-account',
}
