/**
 * @file rate-limit-counter.port.ts
 * @description Transport-neutral contract for an atomic counter admission attempt.
 */

import type { RateLimiterDefinition, RateLimiterName } from 'src/core/security/rate-limiting/rate-limit-policy';

/**
 * Injection token for {@link IRateLimitCounterPort}.
 */
export const TOKEN_RATE_LIMIT_COUNTER_PORT = Symbol();

/**
 * Atomic admission input; this operation can modify counting and blocking state.
 */
export type RateLimitCounterAttempt = Pick<
    RateLimiterDefinition,
    'limit' | 'windowSeconds' | 'blockDurationSeconds'
> & {
    /**
     * Policy-scoped logical key, including service namespace and tracker.
     */
    readonly key: string;

    /**
     * Stable limiter name.
     */
    readonly limiterName: RateLimiterName;
};

/**
 * Admission outcome; HTTP formatting and request identity are outside this contract.
 */
export type RateLimitCounterResult =
    | {
          /**
           * The attempt consumed budget and may continue.
           */
          readonly allowed: true;
      }
    | {
          /**
           * This counter currently blocks the attempt.
           */
          readonly allowed: false;

          /**
           * Positive whole seconds remaining on the first blocking counter.
           */
          readonly retryAfterSeconds: number;
      };

/**
 * Owns atomic admission against shared rate-limit storage.
 */
export interface IRateLimitCounterPort {
    /**
     * Checks and, when admitted, consumes this counter's request budget.
     *
     * @param attempt Counter identity and budget.
     * @returns Admission or the remaining fixed block duration.
     * @throws {DependencyUnavailableException} When storage is unavailable, exhausted or a Redis command times out.
     */
    consume(attempt: RateLimitCounterAttempt): Promise<RateLimitCounterResult>;
}
