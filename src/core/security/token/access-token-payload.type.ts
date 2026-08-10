/**
 * @file access-token-payload.type.ts
 * @description Decoded JWT access token payload shape.
 */

import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';
import type { AuthRole } from 'src/shared/domain/auth-role';

/**
 * Decoded JWT access token payload.
 */
export type AccessTokenPayload = {
    /** Principal identifier. */
    sub: string;

    /** Principal's authentication role. */
    role: AuthRole;

    /** Session version this token was minted at; rejected once the principal's current version exceeds it. */
    sessionVersion: number;

    /** Discriminator rejecting a refresh token presented as an access token. */
    type: AuthTokenType.ACCESS;
};
