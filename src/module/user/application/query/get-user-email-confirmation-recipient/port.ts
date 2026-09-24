/**
 * @file port.ts
 * @description Reads eligible confirmation recipients from authoritative account state.
 */

import type { GetUserEmailConfirmationRecipientResult } from 'src/module/user/application/query/get-user-email-confirmation-recipient/query';

/**
 * Identifies the {@link IGetUserEmailConfirmationRecipientPort} query contract.
 */
export const TOKEN_GET_USER_EMAIL_CONFIRMATION_RECIPIENT_PORT = Symbol();

/**
 * Reads current delivery metadata without a replica or cache.
 */
export interface IGetUserEmailConfirmationRecipientPort {
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
    ): Promise<GetUserEmailConfirmationRecipientResult | null>;
}
