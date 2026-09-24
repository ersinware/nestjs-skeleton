/**
 * @file public.decorator.ts
 * @description Decorator marking routes as publicly accessible, bypassing the global auth guard.
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key flagging a route as public.
 */
export const KEY_DECORATOR_PUBLIC = 'KEY_DECORATOR_PUBLIC';

/**
 * Marks a route or controller as public: `AuthenticationGuard` skips authentication for it.
 */
export const Public = () => SetMetadata(KEY_DECORATOR_PUBLIC, true);
