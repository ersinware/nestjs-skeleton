/**
 * @file port.ts
 * @description Outbound port for GetAdminCredentialsByIdQuery.
 */

import type { GetAdminCredentialsByIdResult } from 'src/module/admin/application/query/get-admin-credentials-by-id/query';

export const TOKEN_GET_ADMIN_CREDENTIALS_BY_ID_PORT = Symbol('TOKEN_GET_ADMIN_CREDENTIALS_BY_ID_PORT');

export interface IGetAdminCredentialsByIdPort {
    /**
     * Retrieves credential fields for a non-deleted admin by ID.
     *
     * @param id The unique identifier of the admin
     * @returns The credentials read model or null if not found
     */
    getCredentialsById(id: string): Promise<GetAdminCredentialsByIdResult | null>;
}
