/**
 * @file port.ts
 * @description Outbound port for GetFreshAdminByIdQuery.
 */

import type { GetFreshAdminByIdResult } from 'src/module/admin/application/query/get-fresh-admin-by-id/query';

/**
 * Dependency injection token representing the {@link IGetFreshAdminByIdPort} contract.
 */
export const TOKEN_GET_FRESH_ADMIN_BY_ID_PORT = Symbol();

/**
 * Primary read contract for the admin projection returned after a mutation.
 */
export interface IGetFreshAdminByIdPort {
    /**
     * Retrieves the public admin read-model by their unique identifier.
     *
     * @param id The unique identifier of the target admin
     * @returns The admin projection, or null if no non-deleted admin is found
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getById(id: string): Promise<GetFreshAdminByIdResult | null>;
}
