/**
 * @file port.ts
 * @description Outbound port for GetAdminByIdQuery.
 */

import type { GetAdminByIdResult } from 'src/module/admin/application/query/get-admin-by-id/query';

export const TOKEN_GET_ADMIN_BY_ID_PORT = Symbol('TOKEN_GET_ADMIN_BY_ID_PORT');

export interface IGetAdminByIdPort {
    /**
     * Retrieves the public read-model of a non-deleted admin by ID.
     *
     * @param id The unique identifier of the admin
     * @returns The admin profile read model or null if not found
     */
    getById(id: string): Promise<GetAdminByIdResult | null>;
}
