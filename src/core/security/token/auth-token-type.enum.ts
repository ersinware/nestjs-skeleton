/**
 * @file auth-token-type.enum.ts
 * @description Discriminator distinguishing access from refresh token payloads.
 */

/**
 * Payload discriminator preventing one token type from being accepted as the other.
 */
export enum AuthTokenType {
    ACCESS = 'access',
    REFRESH = 'refresh',
}
