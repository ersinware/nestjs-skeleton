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
     * Current account revocation version used to reject invalidated invitations.
     */
    readonly revocationVersion: number;

    /**
     * Identity shared with the invitation delivery job, or null when no invitation remains.
     */
    readonly inviteId: string | null;

    /**
     * Fixed invitation expiry preserved across delivery retries, or null when no invitation remains.
     */
    readonly inviteExpiresAt: Date | null;

    /**
     * Account revocation version captured at invitation issuance, or null when no invitation remains.
     */
    readonly inviteRevocationVersion: number | null;
};
