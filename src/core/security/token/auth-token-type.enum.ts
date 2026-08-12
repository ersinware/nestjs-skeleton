/**
 * @file auth-token-type.enum.ts
 * @description Discriminator distinguishing the token payload types this concern mints.
 */

/**
 * Payload discriminator preventing one token type from being accepted as another.
 */
export enum AuthTokenType {
    /** Short-lived token authorizing API requests. */
    ACCESS = 'access',

    /** Long-lived token that only mints new token pairs. */
    REFRESH = 'refresh',

    /** Single-use-by-state token that only activates a pending account; it authorizes nothing else. */
    INVITE = 'invite',
}
