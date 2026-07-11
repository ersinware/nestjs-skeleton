/**
 * @file port.ts
 * @description Outbound port for CheckAdminIsActiveQuery.
 */

import { CheckAdminIsActiveResult } from 'src/module/admin/application/query/check-admin-is-active/query';

export const TOKEN_CHECK_ADMIN_IS_ACTIVE_PORT = Symbol('TOKEN_CHECK_ADMIN_IS_ACTIVE_PORT');

export interface ICheckAdminIsActivePort {
    /**
     * Checks if an admin is active by ID.
     *
     * @param id The unique identifier of the admin
     * @returns True if active, false if inactive, or null if not found
     */
    checkIsActive(id: string): Promise<CheckAdminIsActiveResult | null>;
}
