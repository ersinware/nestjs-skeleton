/**
 * @file refresh-token-payload.type.ts
 * @description Decoded JWT refresh token payload shape.
 */

import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';
import type { PrincipalType } from 'src/shared/domain/principal';

/**
 * Decoded JWT refresh token payload. Carries no permissions: a refresh re-reads the account from the
 * primary and mints the access token from that fresh state, so nothing stale can be carried over.
 */
export type RefreshTokenPayload = {
    /** Principal identifier. */
    sub: string;

    /** Which bounded context owns the principal's account. */
    principalType: PrincipalType;

    /** Unique token identifier; session storage tracks it for rotation and reuse detection. */
    jti: string;

    /** Session version this token was minted at; rejected once the principal's current version exceeds it. */
    sessionVersion: number;

    /** Discriminator rejecting an access token presented as a refresh token. */
    type: AuthTokenType.REFRESH;
};
