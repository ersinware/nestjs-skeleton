/**
 * @file auth-roles.guard.ts
 * @description Authorization guard verifying Role-Based Access Control (RBAC) constraints on routes.
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessDeniedException } from 'src/core/exception';
import type { AuthRole } from 'src/core/security/auth/auth-role.type';
import type { AuthenticatedRequest } from 'src/core/security/auth/authenticated-request.interface';
import { KEY_DECORATOR_ROLES } from 'src/core/security/auth/decorator/roles.decorator';

/**
 * Authorization guard matching user role claims against route role requirements.
 */
@Injectable()
export class AuthRolesGuard implements CanActivate {
    /**
     * Creates an instance of AuthRolesGuard.
     *
     * @param reflector NestJS Reflector to read roles metadata.
     */
    constructor(private readonly reflector: Reflector) {}

    /**
     * Evaluates authorization criteria for the route based on roles.
     *
     * @param context Execution context of the request.
     * @returns True if the user role matches route requirements.
     * @throws {AccessDeniedException} if user role does not match route requirements.
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
