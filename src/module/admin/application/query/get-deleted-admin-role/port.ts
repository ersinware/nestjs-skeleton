/**
 * @file port.ts
 * @description Defines the port for reading a deleted admin's role.
 */

import { GetDeletedAdminRoleResult } from 'src/module/admin/application/query/get-deleted-admin-role/query';

export const TOKEN_GET_DELETED_ADMIN_ROLE_PORT = Symbol('IGetDeletedAdminRolePort');

/**
 * Port to retrieve the role of a soft-deleted admin.
 * Used internally to clean up sessions after deletion.
 */
export interface IGetDeletedAdminRolePort {
    /**
     * Gets the role of a deleted admin by ID.
     *
     * @param id The admin ID.
     * @returns The admin role result or null if not found.
     */
    getDeletedAdminRole(id: string): Promise<GetDeletedAdminRoleResult | null>;
}
