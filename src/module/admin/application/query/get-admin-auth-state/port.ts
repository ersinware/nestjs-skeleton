/**
 * @file port.ts
 * @description Outbound port for GetAdminAuthStateQuery.
 */

import type { GetAdminAuthStateResult } from 'src/module/admin/application/query/get-admin-auth-state/query';

/**
 * Dependency injection token representing the {@link IGetAdminAuthStatePort} contract.
 */
export const TOKEN_GET_ADMIN_AUTH_STATE_PORT = Symbol('TOKEN_GET_ADMIN_AUTH_STATE_PORT');

/**
 * Thin read contract for fetching an admin's authentication-state read-model.
 */
export interface IGetAdminAuthStatePort {
    /**
     * Reads an admin's authentication state by their unique identifier.
     *
     * @param id The unique identifier of the target admin
     * @returns The authentication state, or null when no non-deleted admin exists
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getAuthState(id: string): Promise<GetAdminAuthStateResult | null>;
}
