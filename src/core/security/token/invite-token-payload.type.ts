/**
 * @file invite-token-payload.type.ts
 * @description Decoded JWT invite token payload shape.
 */

import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';

/**
 * Decoded JWT invite token payload bound to the account's persisted revocation version.
 */
export type InviteTokenPayload = {
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

    /**
     * Discriminator rejecting any other token type presented as an invitation.
     */
    readonly type: AuthTokenType.INVITE;
};
