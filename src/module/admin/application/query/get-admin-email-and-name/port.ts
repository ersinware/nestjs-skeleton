/**
 * @file port.ts
 * @description Outbound query port that reads an admin's email and name.
 */

import type { GetAdminEmailAndNameResult } from 'src/module/admin/application/query/get-admin-email-and-name/query';

export const TOKEN_GET_ADMIN_EMAIL_AND_NAME_PORT = Symbol('TOKEN_GET_ADMIN_EMAIL_AND_NAME_PORT');

export interface IGetAdminEmailAndNamePort {
    /**
     * Retrieves only the email and name of a non-deleted admin by ID.
     *
     * @param id The unique identifier of the admin
     * @returns An object containing email and name, or null if not found
     */
    getAdminEmailAndName(id: string): Promise<GetAdminEmailAndNameResult | null>;
}
