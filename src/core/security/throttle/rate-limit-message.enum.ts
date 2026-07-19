/**
 * @file rate-limit-message.enum.ts
 * @description Enum defining the client-safe messages of rate-limit rejections.
 */

/**
 * Enum defining the client-safe messages of rate-limit rejections. Lives with the throttle concern
 * because rate limiting owns this vocabulary — the throttler emits it and the API docs quote it.
 */
export enum RateLimitMessage {
    /**
     * Targets rate limit exceeded errors.
     */
    DEFAULT = 'Too many requests.',
}
