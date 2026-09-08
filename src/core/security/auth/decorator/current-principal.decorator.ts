/**
 * @file current-principal.decorator.ts
 * @description Parameter decorator injecting the request's verified principal.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from 'src/core/security/auth/authenticated-request.type';
import type { Principal } from 'src/shared/domain/principal';

/**
 * Injects the verified principal built from the access-token payload `AuthenticationGuard` attached;
 * `undefined` on `@Public()` routes. Controllers hand it to commands that must weigh the actor
 * against the target, so the token payload itself never leaves the transport layer.
 */
export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal | undefined => {
    const payload = ctx.switchToHttp().getRequest<AuthenticatedRequest>().accessTokenPayload;

    return payload && { id: payload.sub, type: payload.principalType, permissions: payload.permissions };
});
