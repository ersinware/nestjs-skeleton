/**
 * @file port.ts
 * @description Outbound port for GetAdminAuthStateQuery.
 */

import type { GetAdminAuthStateResult } from 'src/module/admin/application/query/get-admin-auth-state/query';

export const TOKEN_GET_ADMIN_AUTH_STATE_PORT = Symbol('TOKEN_GET_ADMIN_AUTH_STATE_PORT');

/**
 * Thin read contract for fetching an admin's authentication-state read-model.
 */
export interface IGetAdminAuthStatePort {
    /**
     * Reads an admin's authentication state (active status + session version) by their unique identifier.
     *
     * @param id The unique identifier of the target admin
     * @returns The authentication state, or null if no admin is found
     */
    getAuthState(id: string): Promise<GetAdminAuthStateResult | null>;
}
