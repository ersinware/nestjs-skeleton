/**
 * @file roles.decorator.ts
 * @description Decorator to declare required RBAC roles for specific routes.
 */

import { SetMetadata } from '@nestjs/common';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';

/**
 * Metadata key used to store required roles for authorization.
 */
export const KEY_DECORATOR_ROLES = 'KEY_DECORATOR_ROLES';

/**
 * Decorator function to declare role requirements on controller actions.
 *
 * @param roles List of roles permitted to access the route.
 * @returns A decorator that assigns the permitted roles to the route.
 */
export const Roles = (...roles: AuthUserRole[]) => SetMetadata(KEY_DECORATOR_ROLES, roles);
