/**
 * @file permissions.decorator.ts
 * @description Decorator declaring the permissions a route requires.
 */

import { SetMetadata } from '@nestjs/common';
import type { Permission } from 'src/shared/domain/principal';

/** Metadata key holding a route's required permissions. */
export const KEY_DECORATOR_PERMISSIONS = 'KEY_DECORATOR_PERMISSIONS';

/**
 * Declares the permissions a route requires, ALL of which the caller's access token must carry;
 * enforced by `AuthorizationGuard`. A permission is held by one kind of principal only, so
 * requiring one also pins the kind of caller — a self-scoped route with no permission pins it
 * with `@PrincipalOnly()` instead.
 *
 * @param permissions The permissions the caller must hold, every one of them.
 */
export const Permissions = (...permissions: Permission[]) => SetMetadata(KEY_DECORATOR_PERMISSIONS, permissions);
