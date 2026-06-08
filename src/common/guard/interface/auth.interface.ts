/**
 * @file auth.interface.ts
 * @description Interfaces defining JWT payload structures and request context extension for authenticated users.
 */

import type { FastifyRequest } from 'fastify';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { AuthTokenType } from 'src/common/enum/auth/auth-token-type.enum';

/**
 * Extended HTTP Request context carrying parsed security attributes.
 */
export interface AuthenticatedRequest extends FastifyRequest<{ Params: Record<string, string> }> {
    /** Authenticated user's JWT details. */
    accessTokenPayload?: AccessTokenPayload;
}

/**
 * Structure of a decoded JWT access token payload.
 */
export interface AccessTokenPayload {
    /** Target subject identifier. */
    sub: string;

    /** Subject authentication role level. */
    role: AuthUserRole;

    /** Classification of the token payload. */
    type: AuthTokenType.ACCESS;
}

/**
 * Structure of a decoded JWT refresh token payload.
 */
export interface RefreshTokenPayload {
    /** Target subject identifier. */
    sub: string;

    /** Subject authentication role level. */
    role: AuthUserRole;

    /** Unique refresh token identifier. */
    jti: string;

    /** Classification of the token payload. */
    type: AuthTokenType.REFRESH;
}
