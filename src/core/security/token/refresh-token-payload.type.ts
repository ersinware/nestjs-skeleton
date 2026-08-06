/**
 * @file refresh-token-payload.type.ts
 * @description Decoded JWT refresh token payload shape.
 */

import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';
import type { AuthRole } from 'src/shared/domain/auth-role';

/**
 * Decoded JWT refresh token payload.
 */
export type RefreshTokenPayload = {
    /** Principal identifier. */
    sub: string;

    /** Principal's authentication role. */
    role: AuthRole;

    /** Unique token identifier; session storage tracks it for rotation and reuse detection. */
    jti: string;

    /** Session version this token was minted at; rejected once the principal's current version exceeds it. */
    version: number;

    /** Discriminator rejecting an access token presented as a refresh token. */
    type: AuthTokenType.REFRESH;
};
