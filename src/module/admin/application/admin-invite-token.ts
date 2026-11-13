/**
 * @file admin-invite-token.ts
 * @description Admin invitation token contract, type discriminator, and dedicated DI token.
 */

import type { TokenPayload } from 'src/core/security/token';

/**
 * Dependency injection token for signing and verifying {@link InviteTokenPayload}.
 */
export const TOKEN_ADMIN_INVITE_TOKEN_PORT = Symbol();

/**
 * Discriminator carried by signed administrator invitation tokens.
 */
export const ADMIN_INVITE_TOKEN_TYPE = 'ADMIN_INVITE_TOKEN_TYPE';

/**
 * Decoded JWT invite token payload bound to the account's persisted revocation version.
 */
export type InviteTokenPayload = TokenPayload<typeof ADMIN_INVITE_TOKEN_TYPE> & {
    /**
     * Identifier of the account the invitation activates.
     */
    readonly sub: string;

    /**
     * Identity of the persisted invitation and its delivery job.
     */
    readonly jti: string;

    /**
     * Fixed expiry in epoch seconds; redelivery never extends it.
     */
    readonly exp: number;

    /**
     * Must equal the account's current revocation version at activation.
     */
    readonly inviteRevocationVersion: number;
};
