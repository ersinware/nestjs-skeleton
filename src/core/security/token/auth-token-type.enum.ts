/**
 * @file auth-token-type.enum.ts
 * @description Discriminator distinguishing the token payload types this concern mints.
 */

/**
 * Payload discriminator preventing one token type from being accepted as another.
 */
export enum AuthTokenType {
    /**
     * Short-lived token authorizing API requests.
     */
    ACCESS = 'access',

    /**
     * Long-lived token that only mints new token pairs.
     */
    REFRESH = 'refresh',

    /**
     * Single-use-by-state token that only activates a pending account; it authorizes nothing else.
     */
    INVITE = 'invite',

    /**
     * Activates a pending user after the current password is verified.
     */
    USER_ACTIVATION = 'user_activation',

    /**
     * Confirms a persisted email change request; it grants no session access.
     */
    EMAIL_CONFIRM = 'email_confirm',

    /**
     * Proves that an upload was authorized for a specific workflow and form.
     */
    UPLOAD = 'upload',
}
