/**
 * @file email-confirmation-token-payload.type.ts
 * @description JWT claims bound to a persisted email change request.
 */

import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';
import type { PrincipalType } from 'src/shared/domain/principal';

/**
 * Verified proof of access to the pending address; account state controls consumption.
 */
export type EmailConfirmationTokenPayload = {
    /**
     * Identifier of the account requesting the change.
     */
    readonly sub: string;

    /**
     * Context owning the account identifier.
     */
    readonly principalType: PrincipalType;

    /**
     * Identity of the persisted request and its delivery job.
     */
    readonly jti: string;

    /**
     * Fixed expiry in epoch seconds; redelivery never extends it.
     */
    readonly exp: number;

    /**
     * Account revocation version captured when the request was created.
     */
    readonly emailRevocationVersion: number;

    /**
     * Discriminator preventing other credentials from confirming an email change.
     */
    readonly type: AuthTokenType.EMAIL_CONFIRM;
};
