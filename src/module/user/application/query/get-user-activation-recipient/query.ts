/**
 * @file query.ts
 * @description Defines the current user details required to send an activation email.
 */

/**
 * Current details used to reproduce and address a user activation email.
 */
export type GetUserActivationRecipientResult = {
    /**
     * Email address to which the activation link is sent.
     */
    readonly email: string;

    /**
     * Display name used in the activation greeting.
     */
    readonly name: string;

    /**
     * Identity shared with the activation delivery job.
     */
    readonly activationId: string;

    /**
     * Fixed activation expiry preserved across delivery retries.
     */
    readonly activationExpiresAt: Date;

    /**
     * Account revocation version captured when activation was requested.
     */
    readonly activationRevocationVersion: number;
};
