/**
 * @file access-token-payload.type.ts
 * @description Type defining the JWT access token payload structure.
 */

import { AuthTokenType } from 'src/core/security/auth/enum/auth-token-type.enum';
import type { AuthRole } from 'src/core/security/auth/type/auth-role.type';

/**
 * Structure of a decoded JWT access token payload.
 */
export type AccessTokenPayload = {
    /** Target subject identifier. */
    sub: string;

    /** Subject authentication role level. */
    role: AuthRole;

    /** Classification of the token payload. */
    type: AuthTokenType.ACCESS;
};
