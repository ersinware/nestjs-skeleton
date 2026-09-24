/**
 * @file authenticated.decorator.ts
 * @description Decorator explicitly declaring access for any authenticated principal.
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key marking deliberate access for any authenticated principal.
 */
export const KEY_DECORATOR_AUTHENTICATED = 'KEY_DECORATOR_AUTHENTICATED';

/**
 * Declares access for any authenticated principal. Authentication remains enforced by the
 * global `AuthenticationGuard`; this marker does not override principal or permission requirements.
 *
 * @returns Metadata decorator expressing the route's authentication policy.
 */
export function Authenticated(): MethodDecorator & ClassDecorator {
    return SetMetadata(KEY_DECORATOR_AUTHENTICATED, true);
}
