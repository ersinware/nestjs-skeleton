/**
 * @file roles.decorator.ts
 * @description Decorator declaring the roles required to access a route.
 */

import { SetMetadata } from '@nestjs/common';
import type { AuthRole } from 'src/shared/domain/auth-role';

/** Metadata key holding a route's required roles. */
export const KEY_DECORATOR_ROLES = 'KEY_DECORATOR_ROLES';

/**
 * Declares the roles permitted to access a route or controller, enforced by `AuthRolesGuard`.
 *
 * @param roles Roles permitted to access the route.
 */
export const Roles = (...roles: AuthRole[]) => SetMetadata(KEY_DECORATOR_ROLES, roles);
