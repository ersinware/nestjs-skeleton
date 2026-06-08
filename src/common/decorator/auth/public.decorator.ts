/**
 * @file public.decorator.ts
 * @description Decorator to mark routes as publicly accessible, bypassing global JWT authentication guards.
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key used to flag routes as public.
 */
export const KEY_DECORATOR_PUBLIC = 'KEY_DECORATOR_PUBLIC';

/**
 * Decorator function to make a controller action public.
 */
export const Public = () => SetMetadata(KEY_DECORATOR_PUBLIC, true);
