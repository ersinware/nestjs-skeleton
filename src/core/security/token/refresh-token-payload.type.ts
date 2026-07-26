/**
 * @file refresh-token-payload.type.ts
 * @description Type defining the JWT refresh token payload structure.
 */

import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';
import type { AuthRole } from 'src/shared/domain/auth-role';

/**
 * Structure of a decoded JWT refresh token payload.
 */
export type RefreshTokenPayload = {
    /** Target subject identifier. */
    sub: string;

    /** Subject authentication role level. */
    role: AuthRole;

    /** Unique refresh token identifier. */
    jti: string;

    /** Session version this token was minted at; rejected once the principal's current version exceeds it. */
    version: number;

    /** Classification of the token payload. */
    type: AuthTokenType.REFRESH;
};
