/**
 * @file port.ts
 * @description Outbound port for GetAdminCredentialsByEmailQuery.
 */

import type { GetAdminCredentialsByEmailResult } from 'src/module/admin/application/query/get-admin-credentials-by-email/query';

/**
 * Dependency injection token representing the {@link IGetAdminCredentialsByEmailPort} contract.
 */
export const TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT = Symbol('TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT');

/**
 * Thin read contract for fetching an admin's credential read-model by email.
 */
export interface IGetAdminCredentialsByEmailPort {
    /**
     * Reads an admin's credential read-model by email.
     *
     * @param email The exact email address to look up
     * @returns The credentials, or null when no non-deleted admin exists
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getCredentialsByEmail(email: string): Promise<GetAdminCredentialsByEmailResult | null>;
}
