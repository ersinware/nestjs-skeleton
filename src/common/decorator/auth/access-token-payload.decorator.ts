/**
 * @file access-token-payload.decorator.ts
 * @description Parameter decorator to extract the authenticated user/admin JWT payload from the HTTP request context.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AccessTokenPayload, AuthenticatedRequest } from 'src/common/guard/interface/auth.interface';

/**
 * Decorator to retrieve the current user's authenticated JWT payload from the request context.
 *
 * @param _data Additional data parameter (unused).
 * @param ctx The NestJS execution context.
 * @returns The extracted access token payload, or undefined.
 */
export const AccessTokenPayloadDecorator = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): AccessTokenPayload | undefined => {
        return ctx.switchToHttp().getRequest<AuthenticatedRequest>().accessTokenPayload;
    },
);
