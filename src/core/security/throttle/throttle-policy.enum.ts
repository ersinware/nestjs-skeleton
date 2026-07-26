/**
 * @file throttle-policy.enum.ts
 * @description The rate-limiting policies a route may ask for.
 */

/**
 * What a route asks for, as opposed to how it is enforced.
 *
 * The separation from `ThrottlerName` is what lets a policy grow a second window, or have its numbers
 * retuned, without a single controller changing: an endpoint declares that it is sensitive, and the
 * guard alone decides which limiters that currently means. A route carrying no policy gets DEFAULT.
 */
export enum ThrottlePolicy {
    DEFAULT = 'default',
    CRITICAL = 'critical',
}
