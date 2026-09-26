/**
 * @file user-activation-token-payload.type.ts
 * @description Decoded JWT user activation token payload shape.
 */

import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';

/**
 * Signed proof bound to one pending user activation request.
 */
export type UserActivationTokenPayload = {
    /**
     * User account receiving the activation email.
     */
    readonly sub: string;

    /**
     * Persisted activation request identity.
     */
    readonly jti: string;

    /**
     * Fixed deadline in epoch seconds.
     */
    readonly exp: number;

    /**
     * Account revocation version captured at issuance.
     */
    readonly activationRevocationVersion: number;

    /**
     * Separates activation proof from every other token purpose.
     */
    readonly type: AuthTokenType.USER_ACTIVATION;
};
