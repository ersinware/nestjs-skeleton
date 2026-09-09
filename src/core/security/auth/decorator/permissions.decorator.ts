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
 * @param permissions The permissions the caller must hold, every one of them. At least one
 * permission is required: use `@PrincipalOnly()` for a route that only restricts principal kind.
 */
export function Permissions(...permissions: [Permission, ...Permission[]]): MethodDecorator & ClassDecorator {
    if (permissions.length === 0) {
        throw new Error(
            '@Permissions() requires at least one permission. Use @PrincipalOnly() to restrict a route by principal type.',
        );
    }

    return SetMetadata(KEY_DECORATOR_PERMISSIONS, permissions);
}
