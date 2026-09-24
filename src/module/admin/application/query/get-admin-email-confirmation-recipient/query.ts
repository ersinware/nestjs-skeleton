/**
 * @file query.ts
 * @description Current account metadata required for email confirmation delivery.
 */

/**
 * Projection of an eligible admin and its pending request.
 */
export type GetAdminEmailConfirmationRecipientResult = {
    /**
     * Display name for the greeting.
     */
    readonly name: string;

    /**
     * Request identity retained across retries.
     */
    readonly pendingEmailRequestId: string;

    /**
     * Target address belonging to this request.
     */
    readonly pendingEmail: string;

    /**
     * Fixed deadline that delivery must not extend.
     */
    readonly pendingEmailExpiresAt: Date;

    /**
     * Revocation snapshot captured when the request was created.
     */
    readonly pendingEmailRevocationVersion: number;
};
