/**
 * @file activation-token-payload.type.ts
 * @description Decoded JWT activation token payload shape.
 */

import { AuthTokenType } from 'src/core/security/token/auth-token-type.enum';

/**
 * Signed proof bound to one pending activation request.
 */
export type ActivationTokenPayload = {
    /**
     * Account identity bound to the activation proof.
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
    readonly type: AuthTokenType.ACTIVATION;
};
