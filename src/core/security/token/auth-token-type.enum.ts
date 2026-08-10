/**
 * @file auth-token-type.enum.ts
 * @description Discriminator distinguishing access from refresh token payloads.
 */

/**
 * Payload discriminator preventing one token type from being accepted as the other.
 */
export enum AuthTokenType {
    /** Short-lived token authorizing API requests. */
    ACCESS = 'access',

    /** Long-lived token that only mints new token pairs. */
    REFRESH = 'refresh',
}
