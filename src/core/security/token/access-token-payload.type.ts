/**
 * @file access-token-payload.type.ts
 * @description Decoded JWT access token payload shape.
 */

import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';
import type { Permission, PrincipalType } from 'src/shared/domain/principal';

/**
 * Decoded JWT access token payload. Carries the permissions the principal held at mint time, so
 * the authorization guard decides without a store round-trip; a permission change bumps the
 * session version, which retires every token minted before it.
 */
export type AccessTokenPayload = {
    /** Principal identifier. */
    sub: string;

    /** Which bounded context owns the principal's account. */
    principalType: PrincipalType;

    /** The permissions the principal held when the token was minted. */
    permissions: Permission[];

    /** Session version this token was minted at; rejected once the principal's current version exceeds it. */
    sessionVersion: number;

    /** Discriminator rejecting a refresh token presented as an access token. */
    type: AuthTokenType.ACCESS;
};
