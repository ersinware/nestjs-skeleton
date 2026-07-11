/**
 * @file port.ts
 * @description Outbound port for ListAdminsQuery.
 */

import type { ListAdminsResult } from 'src/module/admin/application/query/list-admins/query';
import { PaginationParams } from 'src/shared/pagination';

export const TOKEN_LIST_ADMINS_PORT = Symbol('TOKEN_LIST_ADMINS_PORT');

export interface IListAdminsPort {
    /**
     * Retrieves a paginated list of non-deleted admin read-models.
     *
     * @param params The pagination limits and search parameters
     * @returns Paginated list of admins
     */
    listAdmins(params: PaginationParams): Promise<ListAdminsResult>;
}
