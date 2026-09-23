/**
 * @file port.ts
 * @description Outbound query port that reads a user's notice recipient details.
 */

import type { GetUserNoticeRecipientResult } from 'src/module/user/application/query/get-user-notice-recipient/query';

/**
 * Identifies the {@link IGetUserNoticeRecipientPort} query contract.
 */
export const TOKEN_GET_USER_NOTICE_RECIPIENT_PORT = Symbol();

/**
 * Reads the current recipient details for a user notice.
 */
export interface IGetUserNoticeRecipientPort {
    /**
     * Reads the current email address and display name of a non-deleted user.
     *
     * @param id The unique identifier of the target user
     * @returns The notice recipient details, or null when no non-deleted user exists
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getNoticeRecipient(id: string): Promise<GetUserNoticeRecipientResult | null>;
}
