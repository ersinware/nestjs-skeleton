/**
 * @file port.ts
 * @description Outbound port for GetAdminByIdQuery.
 */

import type { GetAdminByIdResult } from 'src/module/admin/application/query/get-admin-by-id/query';

/**
 * Dependency injection token representing the {@link IGetAdminByIdPort} contract.
 */
export const TOKEN_GET_ADMIN_BY_ID_PORT = Symbol();

/**
 * Thin read contract for fetching a single admin's read-model by identifier.
 */
export interface IGetAdminByIdPort {
    /**
     * Retrieves the public admin read-model by their unique identifier.
     *
     * @param id The unique identifier of the target admin
     * @returns The admin projection, or null if no active admin is found
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getById(id: string): Promise<GetAdminByIdResult | null>;
}
