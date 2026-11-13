/**
 * @file email-confirmation-token.ts
 * @description JWT claims bound to a persisted email change request.
 */

import type { TokenPayload } from 'src/core/security/token';
import type { PrincipalType } from 'src/shared/domain/principal';

/**
 * Dependency injection token for signing and verifying {@link EmailConfirmationTokenPayload}.
 */
export const TOKEN_EMAIL_CONFIRMATION_TOKEN_PORT = Symbol();

/**
 * Discriminator carried by signed email-change confirmation tokens.
 */
export const EMAIL_CONFIRMATION_TOKEN_TYPE = 'EMAIL_CONFIRMATION_TOKEN_TYPE';

/**
 * Verified proof of access to the pending address; account state controls consumption.
 */
export type EmailConfirmationTokenPayload = TokenPayload<typeof EMAIL_CONFIRMATION_TOKEN_TYPE> & {
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
};
