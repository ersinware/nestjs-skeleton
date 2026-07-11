/**
 * @file port.ts
 * @description Outbound port for GetAdminRoleQuery.
 */

import type { GetAdminRoleResult } from 'src/module/admin/application/query/get-admin-role/query';

export const TOKEN_GET_ADMIN_ROLE_PORT = Symbol('TOKEN_GET_ADMIN_ROLE_PORT');

export interface IGetAdminRolePort {
    /**
     * Retrieves the admin's role.
     *
     * @param id The admin's unique identifier
     * @returns The admin's role if found, otherwise null
     */
    getRole(id: string): Promise<GetAdminRoleResult | null>;
}
