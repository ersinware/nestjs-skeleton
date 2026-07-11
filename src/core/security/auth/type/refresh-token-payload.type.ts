/**
 * @file refresh-token-payload.type.ts
 * @description Type defining the JWT refresh token payload structure.
 */

import { AuthTokenType } from 'src/core/security/auth/enum/auth-token-type.enum';
import type { AuthRole } from 'src/core/security/auth/type/auth-role.type';

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

    /** Classification of the token payload. */
    type: AuthTokenType.REFRESH;
};
