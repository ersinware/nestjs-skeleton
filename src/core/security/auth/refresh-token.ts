/**
 * @file refresh-token.ts
 * @description Decoded JWT refresh token payload shape.
 */

import type { SessionIdentity } from 'src/core/security/session';
import type { TokenPayload } from 'src/core/security/token';
import type { PrincipalType } from 'src/shared/domain/principal';

/**
 * Dependency injection token for signing and verifying {@link RefreshTokenPayload}.
 */
export const TOKEN_AUTH_REFRESH_TOKEN_PORT = Symbol();

/**
 * Discriminator carried by signed refresh credentials.
 */
export const REFRESH_TOKEN_TYPE = 'REFRESH_TOKEN_TYPE';

/**
 * Decoded JWT refresh token payload. Carries no permissions: a refresh re-reads the account from the
 * primary and mints the access token from that fresh state, so nothing stale can be carried over.
 */
export type RefreshTokenPayload = TokenPayload<typeof REFRESH_TOKEN_TYPE> &
    SessionIdentity & {
        /**
         * Signed credential expiry in Unix seconds.
         */
        readonly exp: number;

        /**
         * Principal identifier.
         */
        readonly sub: string;

        /**
         * Which bounded context owns the principal's account.
         */
        readonly principalType: PrincipalType;

        /**
         * Unique token identifier; session storage tracks it for rotation and reuse detection.
         */
        readonly jti: string;

        /**
         * Session version this token was minted at; rejected once the principal's current version exceeds it.
         */
        readonly sessionVersion: number;
    };
