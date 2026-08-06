/**
 * @file auth-roles.guard.ts
 * @description Authorization guard verifying Role-Based Access Control (RBAC) constraints on routes.
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from 'src/core/security/auth/authenticated-request.type';
import { KEY_DECORATOR_ROLES } from 'src/core/security/auth/decorator/roles.decorator';
import type { AuthRole } from 'src/shared/domain/auth-role';
import { AccessDeniedException } from 'src/shared/exception';

/**
 * Global authorization guard matching the token's role claim against `@Roles()` requirements.
 */
@Injectable()
export class AuthRolesGuard implements CanActivate {
    /**
     * @param reflector Reads the `@Roles()` metadata.
     */
    constructor(private readonly reflector: Reflector) {}

    /**
     * Admits routes without `@Roles()`, otherwise requires the token's role to be among the required ones.
     *
     * @param context Execution context of the request.
     * @returns True if authorized.
     * @throws {AccessDeniedException} if the token's role does not satisfy the route's requirements.
     */
    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<AuthRole[]>(KEY_DECORATOR_ROLES, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requiredRoles?.length) {
            return true;
        }

        const accessTokenPayload = context.switchToHttp().getRequest<AuthenticatedRequest>().accessTokenPayload;
        if (!accessTokenPayload || !accessTokenPayload.role || !requiredRoles.includes(accessTokenPayload.role)) {
            throw new AccessDeniedException();
        }

        return true;
    }
}
