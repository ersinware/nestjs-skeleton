/**
 * @file query.ts
 * @description Defines the current admin details required to send an activation invitation.
 */

/**
 * Current details used to mint and address an admin activation invitation.
 */
export type GetAdminInviteRecipientResult = {
    readonly email: string;
    readonly name: string;
    readonly revocationVersion: number;
};
