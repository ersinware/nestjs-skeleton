/**
 * @file port.ts
 * @description Outbound query port that reads an eligible admin invitation recipient.
 */

import type { GetAdminInviteRecipientResult } from 'src/module/admin/application/query/get-admin-invite-recipient/query';

/**
 * Identifies the admin invitation recipient query contract.
 */
export const TOKEN_GET_ADMIN_INVITE_RECIPIENT_PORT = Symbol('TOKEN_GET_ADMIN_INVITE_RECIPIENT_PORT');

/**
 * Reads the current details required to send an admin activation invitation.
 */
export interface IGetAdminInviteRecipientPort {
    /**
     * Reads a pending, non-banned, non-deleted admin's invitation details.
     *
     * @param id The unique identifier of the target admin
     * @returns The invitation details, or null when the admin is no longer eligible
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getInviteRecipient(id: string): Promise<GetAdminInviteRecipientResult | null>;
}
