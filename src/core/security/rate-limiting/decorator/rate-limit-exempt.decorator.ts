/**
 * @file rate-limit-exempt.decorator.ts
 * @description Explicit operational probe exemption from rate-limit checks.
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Metadata identifying an explicitly exempt endpoint.
 */
export const KEY_DECORATOR_RATE_LIMIT_EXEMPT = 'KEY_DECORATOR_RATE_LIMIT_EXEMPT';

/**
 * Exempts an operational probe from rate-limit storage access.
 *
 * @returns The explicit endpoint exemption decorator.
 */
export function RateLimitExempt(): MethodDecorator {
    return SetMetadata(KEY_DECORATOR_RATE_LIMIT_EXEMPT, true);
}
