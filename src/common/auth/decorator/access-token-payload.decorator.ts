/**
 * @file access-token-payload.decorator.ts
 * @description Parameter decorator to extract the authenticated user/admin JWT payload from the HTTP request context.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AccessTokenPayload } from 'src/common/auth/interface/access-token-payload.interface';
import { AuthenticatedRequest } from 'src/common/auth/interface/authenticated-request.interface';

/**
 * Decorator to retrieve the current user's authenticated JWT payload from the request context.
 *
 * @param _data Additional data parameter (unused).
 * @param ctx The NestJS execution context.
 * @returns A parameter decorator that extracts the authenticated access token payload.
 */
export const AccessTokenPayloadDecorator = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): AccessTokenPayload | undefined => {
        return ctx.switchToHttp().getRequest<AuthenticatedRequest>().accessTokenPayload;
    },
);
