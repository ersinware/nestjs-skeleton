/**
 * @file critical-throttle.decorator.ts
 * @description Decorator to mark routes as critical, enforcing strict rate-limiting policies.
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key used to flag routes as critical for throttling.
 */
export const KEY_DECORATOR_CRITICAL_THROTTLE = 'KEY_DECORATOR_CRITICAL_THROTTLE';

/**
 * Decorator function to apply a critical rate limit policy to a controller action or handler.
 *
 * @returns A decorator that marks the endpoint as critical for rate limiting.
 */
export const CriticalThrottle = () => SetMetadata(KEY_DECORATOR_CRITICAL_THROTTLE, true);
