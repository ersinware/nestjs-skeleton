/**
 * @file rate-limit.decorator.ts
 * @description Explicit per-endpoint rate-limit policy declaration.
 */

import { SetMetadata } from '@nestjs/common';
import { RateLimitPolicy } from 'src/core/security/rate-limiting/rate-limit-policy';

/**
 * Metadata identifying a method's selected policy.
 */
export const KEY_DECORATOR_RATE_LIMIT = 'KEY_DECORATOR_RATE_LIMIT';

/**
 * Selects a central policy without putting budgets on the endpoint.
 *
 * @param policy Active policy to apply.
 * @returns The endpoint metadata decorator.
 */
export function RateLimit(policy: RateLimitPolicy): MethodDecorator {
    return SetMetadata(KEY_DECORATOR_RATE_LIMIT, policy);
}
