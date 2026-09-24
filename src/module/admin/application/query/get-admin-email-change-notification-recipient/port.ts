/**
 * @file port.ts
 * @description Reads an immutable admin email-change notification recipient.
 */

import type { GetAdminEmailChangeNotificationRecipientResult } from 'src/module/admin/application/query/get-admin-email-change-notification-recipient/query';

/**
 * Dependency injection token for the {@link IGetAdminEmailChangeNotificationRecipientPort} contract.
 */
export const TOKEN_GET_ADMIN_EMAIL_CHANGE_NOTIFICATION_RECIPIENT_PORT = Symbol();

/**
 * Reads a committed recipient by delivery identity.
 */
export interface IGetAdminEmailChangeNotificationRecipientPort {
    /**
     * Reads the immutable delivery record.
     *
     * @param id Immutable notification identity
     * @returns Stored recipient, or null when no matching record exists
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getEmailChangeNotificationRecipient(id: string): Promise<GetAdminEmailChangeNotificationRecipientResult | null>;
}
