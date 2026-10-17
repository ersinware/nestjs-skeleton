/**
 * @file port.ts
 * @description Outbound query port that reads an eligible admin invitation recipient.
 */

import type { GetAdminInviteRecipientResult } from 'src/module/admin/application/query/get-admin-invite-recipient/query';

/**
 * Identifies the {@link IGetAdminInviteRecipientPort} query contract.
 */
export const TOKEN_GET_ADMIN_INVITE_RECIPIENT_PORT = Symbol();

/**
 * Reads the current details required to send an admin activation invitation.
 */
export interface IGetAdminInviteRecipientPort {
    /**
     * Reads a current, eligible invitation for the requested delivery.
     *
     * @param id The unique identifier of the target admin
     * @param inviteId The original invitation identity
     * @returns The invitation details, or null when delivery is no longer allowed
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getInviteRecipient(id: string, inviteId: string): Promise<GetAdminInviteRecipientResult | null>;
}
