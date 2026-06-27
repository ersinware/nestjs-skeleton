/**
 * @file access-token-payload.interface.ts
 * @description Interface defining the JWT access token payload structure.
 */

import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { AuthTokenType } from 'src/common/auth/enum/auth-token-type.enum';

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
