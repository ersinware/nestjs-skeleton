/**
 * @file query.ts
 * @description Immutable recipient details for a completed user email change.
 */

/**
 * Stored old-address recipient and completion time for one delivery.
 */
export type GetUserEmailChangeNotificationRecipientResult = {
    /**
     * Address held before the confirmed change.
     */
    readonly previousEmail: string;

    /**
     * Time the change was committed.
     */
    readonly createdAt: Date;
};
