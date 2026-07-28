/**
 * @file port.ts
 * @description Outbound query port that reads an admin's access-control projection.
 */

import { GetAdminAccessProjectionResult } from 'src/module/admin/application/query/get-admin-access-projection/query';

export const TOKEN_GET_ADMIN_ACCESS_PROJECTION_PORT = Symbol('TOKEN_GET_ADMIN_ACCESS_PROJECTION_PORT');

/**
 * Thin read contract for fetching the access-control projection of an admin.
 */
export interface IGetAdminAccessProjectionPort {
    /**
     * Reads the access-control projection of an admin by id without the soft-delete filter, so a
     * deleted admin resolves to its (revoked) projection rather than being hidden or throwing.
     *
     * @param id The unique identifier of the target admin
     * @returns The projection, or null when no row exists
     */
    getAdminAccessProjection(id: string): Promise<GetAdminAccessProjectionResult | null>;
}
