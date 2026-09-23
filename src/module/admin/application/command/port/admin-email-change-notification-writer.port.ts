/**
 * @file admin-email-change-notification-writer.port.ts
 * @description Persists the original recipient of a completed email change.
 */

/**
 * Dependency injection token for the {@link IAdminEmailChangeNotificationWriterPort} contract.
 */
export const TOKEN_ADMIN_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT = Symbol();

/**
 * Immutable delivery evidence captured by the email confirmation handler.
 */
export type AdminEmailChangeNotification = {
    /**
     * Handler-generated UUID v7 and notification job delivery identity.
     */
    readonly id: string;

    /**
     * Account whose address changed.
     */
    readonly accountId: string;

    /**
     * Original recipient address captured before mutation.
     */
    readonly previousEmail: string;

    /**
     * Time of the completed address change.
     */
    readonly createdAt: Date;
};

/**
 * Insert-only persistence participating in the caller's mutation transaction.
 */
export interface IAdminEmailChangeNotificationWriterPort {
    /**
     * Inserts immutable recipient evidence alongside the account, jobs, and audit.
     *
     * @param notification Recipient evidence captured for this change
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    save(notification: AdminEmailChangeNotification): Promise<void>;
}
