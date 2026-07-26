/**
 * @file throttle-policy.decorator.ts
 * @description Decorator selecting which rate-limiting policy a route is enforced under.
 */

import { SetMetadata } from '@nestjs/common';
import { ThrottlePolicy } from 'src/core/security/throttle/throttle-policy.enum';

/**
 * Metadata key carrying the route's chosen throttle policy.
 */
export const KEY_DECORATOR_THROTTLE_POLICY = 'KEY_DECORATOR_THROTTLE_POLICY';

/**
 * Applies a named rate-limiting policy to a controller or handler.
 *
 * The decorator carries the policy NAME rather than a boolean "is critical" flag, so a new policy is
 * added by declaring one — an enum member, a limiter, its env variables — instead of by editing the
 * guard that reads it. That also lets endpoints with genuinely different rhythms stop sharing one set
 * of numbers: signing in, registering, and administering are all sensitive, but not at the same rate.
 *
 * @param policy The policy to enforce this route under.
 * @returns A decorator binding the route to that policy.
 */
export const UseThrottlePolicy = (policy: ThrottlePolicy) => SetMetadata(KEY_DECORATOR_THROTTLE_POLICY, policy);
