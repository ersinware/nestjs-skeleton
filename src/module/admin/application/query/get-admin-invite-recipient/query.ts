/**
 * @file query.ts
 * @description Defines the current admin details required to send an activation invitation.
 */

/**
 * Current details used to reproduce and address an admin activation invitation.
 */
export type GetAdminInviteRecipientResult = {
    /**
     * Email address to which the activation invitation is sent.
     */
    readonly email: string;

    /**
     * Display name used in the invitation greeting.
     */
    readonly name: string;

    /**
     * Identity shared with the invitation delivery job.
     */
    readonly inviteId: string;

    /**
     * Fixed invitation expiry preserved across delivery retries.
     */
    readonly inviteExpiresAt: Date;

    /**
     * Account revocation version captured at invitation issuance.
     */
    readonly inviteRevocationVersion: number;
};
