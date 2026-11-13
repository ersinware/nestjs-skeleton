/**
 * @file access-token.ts
 * @description Decoded JWT access token payload shape.
 */

import type { TokenPayload } from 'src/core/security/token';
import type { Permission, PrincipalType } from 'src/shared/domain/principal';

/**
 * Dependency injection token for signing and verifying {@link AccessTokenPayload}.
 */
export const TOKEN_AUTH_ACCESS_TOKEN_PORT = Symbol();

/**
 * Discriminator carried by signed access credentials.
 */
export const ACCESS_TOKEN_TYPE = 'ACCESS_TOKEN_TYPE';

/**
 * Decoded JWT access token payload. Carries the permissions the principal held at mint time, so
 * the authorization guard decides without a store round-trip; a permission change bumps the
 * session version, which retires every token minted before it.
 */
export type AccessTokenPayload = TokenPayload<typeof ACCESS_TOKEN_TYPE> & {
    /**
     * Signed credential expiry in Unix seconds.
     */
    readonly exp: number;

    /**
     * Principal identifier.
     */
    readonly sub: string;

    /**
     * Stable login session identifier checked against the session store.
     */
    readonly sid: string;

    /**
     * Which bounded context owns the principal's account.
     */
    readonly principalType: PrincipalType;

    /**
     * The permissions the principal held when the token was minted.
     */
    readonly permissions: readonly Permission[];

    /**
     * Session version this token was minted at; rejected once the principal's current version exceeds it.
     */
    readonly sessionVersion: number;
};
