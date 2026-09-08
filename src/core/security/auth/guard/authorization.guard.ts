/**
 * @file authorization.guard.ts
 * @description Global authorization guard matching the verified token's kind and permissions against the route's requirements.
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from 'src/core/security/auth/authenticated-request.type';
import { KEY_DECORATOR_PERMISSIONS } from 'src/core/security/auth/decorator/permissions.decorator';
import { KEY_DECORATOR_PRINCIPAL_ONLY } from 'src/core/security/auth/decorator/principal-only.decorator';
import type { Permission, PrincipalType } from 'src/shared/domain/principal';
import { AccessDeniedException } from 'src/shared/exception';

/**
 * Global authorization guard. Runs after `AuthenticationGuard` and decides from the verified payload alone:
 * `@PrincipalOnly()` pins the kind of caller, `@Permissions()` requires every listed permission.
 * A route declaring neither admits any authenticated principal.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
    /**
     * @param reflector Reads the `@PrincipalOnly()` and `@Permissions()` metadata.
     */
    constructor(private readonly reflector: Reflector) {}

    /**
     * Admits routes without requirements, otherwise requires the token to be of the pinned kind
     * and to carry every required permission.
     *
     * @param context Execution context of the request.
     * @returns True if authorized.
     * @throws {AccessDeniedException} if the token's kind or permissions do not satisfy the route.
     */
    canActivate(context: ExecutionContext): boolean {
        const targets = [context.getHandler(), context.getClass()],
            principalOnly = this.reflector.getAllAndOverride<PrincipalType | undefined>(
                KEY_DECORATOR_PRINCIPAL_ONLY,
                targets,
            ),
            requiredPermissions = this.reflector.getAllAndOverride<Permission[] | undefined>(
                KEY_DECORATOR_PERMISSIONS,
                targets,
            );

        if (!principalOnly && !requiredPermissions?.length) {
            return true;
        }

        const payload = context.switchToHttp().getRequest<AuthenticatedRequest>().accessTokenPayload;

        // A public route never declares a requirement, so a missing payload here is a token the
        // auth guard did not attach: refuse rather than reason about an absent identity.
        if (!payload) {
            throw new AccessDeniedException();
        }

        if (principalOnly && payload.principalType !== principalOnly) {
            throw new AccessDeniedException();
        }

        if (requiredPermissions?.some((permission) => !payload.permissions.includes(permission))) {
            throw new AccessDeniedException();
        }

        return true;
    }
}
