/**
 * @file access-token-payload.type.ts
 * @description Type defining the JWT access token payload structure.
 */

import type { AuthRole } from 'src/core/security/auth';
import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';

/**
 * Structure of a decoded JWT access token payload.
 */
export type AccessTokenPayload = {
    /** Target subject identifier. */
    sub: string;

    /** Subject authentication role level. */
    role: AuthRole;

    /** Session version this token was minted at; rejected once the principal's current version exceeds it. */
    version: number;

    /** Classification of the token payload. */
    type: AuthTokenType.ACCESS;
};
