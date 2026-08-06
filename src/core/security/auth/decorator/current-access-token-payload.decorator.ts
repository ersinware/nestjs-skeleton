/**
 * @file current-access-token-payload.decorator.ts
 * @description Parameter decorator injecting the request's verified access-token payload.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from 'src/core/security/auth/authenticated-request.type';
import type { AccessTokenPayload } from 'src/core/security/token';

/**
 * Injects the verified access-token payload attached by `AuthGuard`; `undefined` on `@Public()` routes.
 */
export const CurrentAccessTokenPayload = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): AccessTokenPayload | undefined => {
        return ctx.switchToHttp().getRequest<AuthenticatedRequest>().accessTokenPayload;
    },
);
