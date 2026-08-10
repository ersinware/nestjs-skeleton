/**
 * @file port.ts
 * @description Outbound query port that reads an admin's session version.
 */

import type { GetAdminSessionVersionResult } from 'src/module/admin/application/query/get-admin-session-version/query';

/**
 * Dependency injection token representing the {@link IGetAdminSessionVersionPort} contract.
 */
export const TOKEN_GET_ADMIN_SESSION_VERSION_PORT = Symbol('TOKEN_GET_ADMIN_SESSION_VERSION_PORT');

/**
 * Thin read contract for fetching the session version of an admin.
 */
export interface IGetAdminSessionVersionPort {
    /**
     * Reads an admin's session version without the soft-delete filter, so a deleted admin resolves
     * to its (revoked) version rather than being hidden.
     *
     * @param id The unique identifier of the target admin
     * @returns The session version, or null when no row exists
     */
    getSessionVersion(id: string): Promise<GetAdminSessionVersionResult | null>;
}
