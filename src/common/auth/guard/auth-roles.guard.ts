/**
 * @file auth-roles.guard.ts
 * @description Authorization guard verifying Role-Based Access Control (RBAC) constraints on routes.
 */

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { KEY_DECORATOR_ROLES } from 'src/common/auth/decorator/roles.decorator';
import type { AuthenticatedRequest } from '../interface/authenticated-request.interface';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { ForbiddenType } from 'src/common/exception/enum/forbidden-type.enum';

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
     * @throws {ForbiddenException} if user role does not match route requirements.
     */
    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<AuthUserRole[]>(KEY_DECORATOR_ROLES, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requiredRoles?.length) {
            return true;
        }

        const accessTokenPayload = context.switchToHttp().getRequest<AuthenticatedRequest>().accessTokenPayload;

        if (!accessTokenPayload || !accessTokenPayload.role || !requiredRoles.includes(accessTokenPayload.role)) {
            throw new ForbiddenException(ForbiddenType.DEFAULT);
        }

        return true;
    }
}
