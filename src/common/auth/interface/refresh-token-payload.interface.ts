/**
 * @file refresh-token-payload.interface.ts
 * @description Interface defining the JWT refresh token payload structure.
 */

import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { AuthTokenType } from 'src/common/auth/enum/auth-token-type.enum';

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
