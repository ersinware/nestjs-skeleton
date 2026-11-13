/**
 * @file user-activation-token.ts
 * @description User activation token contract, type discriminator, and dedicated DI token.
 */

import type { TokenPayload } from 'src/core/security/token';

/**
 * Dependency injection token for signing and verifying {@link ActivationTokenPayload}.
 */
export const TOKEN_USER_ACTIVATION_TOKEN_PORT = Symbol();

/**
 * Discriminator carried by signed user activation tokens.
 */
export const USER_ACTIVATION_TOKEN_TYPE = 'USER_ACTIVATION_TOKEN_TYPE';

/**
 * Decoded JWT activation token payload bound to the user's persisted revocation version.
 */
export type ActivationTokenPayload = TokenPayload<typeof USER_ACTIVATION_TOKEN_TYPE> & {
    /**
     * Identifier of the user account the token activates.
     */
    readonly sub: string;

    /**
     * Identity of the activation issuance and its delivery job.
     */
    readonly jti: string;

    /**
     * Fixed expiry in epoch seconds; resend never extends it.
     */
    readonly exp: number;

    /**
     * Must equal the user account's current activation revocation version.
     */
    readonly activationRevocationVersion: number;
};
