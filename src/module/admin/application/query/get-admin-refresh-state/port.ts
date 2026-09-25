/**
 * @file port.ts
 * @description Outbound port for GetAdminRefreshStateQuery.
 */

import type { GetAdminRefreshStateResult } from 'src/module/admin/application/query/get-admin-refresh-state/query';

/**
 * Dependency injection token representing the {@link IGetAdminRefreshStatePort} contract.
 */
export const TOKEN_GET_ADMIN_REFRESH_STATE_PORT = Symbol();

/**
 * Reads current claims only for accounts eligible to refresh the supplied token version.
 */
export interface IGetAdminRefreshStatePort {
    /**
     * Reads a non-deleted, non-banned account whose revocation floor accepts the token version.
     *
     * @param id The account identifier
     * @param tokenSessionVersion The verified refresh token's session version
     * @returns Current token claims, or null when refresh is not allowed
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getRefreshState(id: string, tokenSessionVersion: number): Promise<GetAdminRefreshStateResult | null>;
}
