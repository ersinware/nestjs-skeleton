/**
 * @file port.ts
 * @description Reads eligible confirmation recipients from authoritative account state.
 */

import type { GetAdminEmailConfirmationRecipientResult } from 'src/module/admin/application/query/get-admin-email-confirmation-recipient/query';

/**
 * Identifies the confirmation recipient query contract.
 */
export const TOKEN_GET_ADMIN_EMAIL_CONFIRMATION_RECIPIENT_PORT = Symbol();

/**
 * Reads current delivery metadata without a replica or cache.
 */
export interface IGetAdminEmailConfirmationRecipientPort {
    /**
     * Reads matching, unexpired, non-revoked request metadata for an active, non-banned, non-deleted account.
     *
     * @param id Target account identifier
     * @param deliveryId Request identity assigned to the delivery job
     * @returns Recipient metadata, or null when the account or request is ineligible
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getEmailConfirmationRecipient(
        id: string,
        deliveryId: string,
    ): Promise<GetAdminEmailConfirmationRecipientResult | null>;
}
