/**
 * @file port.ts
 * @description Outbound query port that reads an admin's notice recipient details.
 */

import type { GetAdminNoticeRecipientResult } from 'src/module/admin/application/query/get-admin-notice-recipient/query';

/**
 * Identifies the {@link IGetAdminNoticeRecipientPort} query contract.
 */
export const TOKEN_GET_ADMIN_NOTICE_RECIPIENT_PORT = Symbol();

/**
 * Reads the current recipient details for an admin notice.
 */
export interface IGetAdminNoticeRecipientPort {
    /**
     * Reads the current email address and display name of a non-deleted admin.
     *
     * @param id The unique identifier of the target admin
     * @returns The notice recipient details, or null when no non-deleted admin exists
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getNoticeRecipient(id: string): Promise<GetAdminNoticeRecipientResult | null>;
}
