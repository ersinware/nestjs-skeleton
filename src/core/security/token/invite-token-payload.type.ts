/**
 * @file invite-token-payload.type.ts
 * @description Decoded JWT invite token payload shape.
 */

import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';

/**
 * Decoded JWT invite token payload. Minimal by design: the account is re-read at activation, so the
 * token carries only the subject and the discriminator.
 */
export type InviteTokenPayload = {
    /** Identifier of the account the invitation activates. */
    sub: string;

    /** Discriminator rejecting any other token type presented as an invitation. */
    type: AuthTokenType.INVITE;
};
