/**
 * @file authorization.guard.ts
 * @description Global authorization guard matching the verified token's kind and permissions against the route's requirements.
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { readAuthPolicy } from 'src/core/security/auth/auth-policy';
import type { AuthenticatedRequest } from 'src/core/security/auth/authenticated-request.type';
import { AccessDeniedException } from 'src/shared/exception';

/**
 * Global authorization guard. Runs after `AuthenticationGuard` and decides from the verified payload alone:
 * `@PrincipalOnly()` pins the kind of caller, `@Permissions()` requires every listed permission.
 * Explicit authenticated access admits either principal kind; missing policies are wiring errors.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
    /**
     * @param reflector Reads the endpoint access policy.
     */
    constructor(private readonly reflector: Reflector) {}

    /**
     * Admits public routes, otherwise requires a verified token of the pinned kind
     * and to carry every required permission.
     *
     * @param context Execution context of the request.
     * @returns True if authorized.
     * @throws {AccessDeniedException} if the token's kind or permissions do not satisfy the route.
     */
    canActivate(context: ExecutionContext): boolean {
        const policy = readAuthPolicy(this.reflector, context.getClass(), context.getHandler());

        if (policy.public) {
            return true;
        }

        const payload = context.switchToHttp().getRequest<AuthenticatedRequest>().accessTokenPayload;

        // Every non-public policy requires the authentication guard to have verified an identity.
        if (!payload) {
            throw new AccessDeniedException();
        }

        if (policy.principalType && payload.principalType !== policy.principalType) {
            throw new AccessDeniedException();
        }

        if (policy.permissions.some((permission) => !payload.permissions.includes(permission))) {
            throw new AccessDeniedException();
        }

        return true;
    }
}
