/**
 * @file port.ts
 * @description Outbound query port that reads an eligible user activation recipient.
 */

import type { GetUserActivationRecipientResult } from 'src/module/user/application/query/get-user-activation-recipient/query';

/**
 * Identifies the {@link IGetUserActivationRecipientPort} query contract.
 */
export const TOKEN_GET_USER_ACTIVATION_RECIPIENT_PORT = Symbol();

/**
 * Reads the current details required to send a user activation email.
 */
export interface IGetUserActivationRecipientPort {
    /**
     * Reads a current, eligible activation request for the requested delivery.
     *
     * @param id The unique identifier of the target user
     * @param deliveryId The original activation delivery identity
     * @returns The activation details, or null when delivery is no longer allowed
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getActivationRecipient(id: string, deliveryId: string): Promise<GetUserActivationRecipientResult | null>;
}
