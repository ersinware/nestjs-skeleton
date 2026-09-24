/**
 * @file port.ts
 * @description Reads an immutable user email-change notification recipient.
 */

import type { GetUserEmailChangeNotificationRecipientResult } from 'src/module/user/application/query/get-user-email-change-notification-recipient/query';

/**
 * Dependency injection token for the {@link IGetUserEmailChangeNotificationRecipientPort} contract.
 */
export const TOKEN_GET_USER_EMAIL_CHANGE_NOTIFICATION_RECIPIENT_PORT = Symbol();

/**
 * Reads a committed recipient by delivery identity.
 */
export interface IGetUserEmailChangeNotificationRecipientPort {
    /**
     * Reads the immutable delivery record.
     *
     * @param id Immutable notification identity
     * @returns Stored recipient, or null when no matching record exists
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getEmailChangeNotificationRecipient(id: string): Promise<GetUserEmailChangeNotificationRecipientResult | null>;
}
