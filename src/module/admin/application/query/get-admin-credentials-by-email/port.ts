/**
 * @file port.ts
 * @description Outbound port for GetAdminCredentialsByEmailQuery.
 */

import type { GetAdminCredentialsByEmailResult } from 'src/module/admin/application/query/get-admin-credentials-by-email/query';

export const TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT = Symbol('TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT');

/**
 * Thin read contract for fetching an admin's credential read-model by email.
 */
export interface IGetAdminCredentialsByEmailPort {
    /**
     * Retrieves credential fields for a non-deleted admin by email.
     *
     * @param email The exact email address to query
     * @returns The credentials read model or null if not found
     */
    getCredentialsByEmail(email: string): Promise<GetAdminCredentialsByEmailResult | null>;
}
