/**
 * @file port.ts
 * @description Outbound port for ListAdminsQuery.
 */

import type { ListAdminsResult } from 'src/module/admin/application/query/list-admins/query';
import { PaginationParams } from 'src/shared/pagination';
import type { SearchParams } from 'src/shared/search';

/**
 * Dependency injection token representing the {@link IListAdminsPort} contract.
 */
export const TOKEN_LIST_ADMINS_PORT = Symbol('TOKEN_LIST_ADMINS_PORT');

/**
 * Thin read contract for listing admin read-models with pagination and search.
 */
export interface IListAdminsPort {
    /**
     * Reads one page of non-deleted admin read-models.
     *
     * @param params The pagination and search parameters
     * @returns The page of admins plus the total row count
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    listAdmins(params: SearchParams & PaginationParams): Promise<ListAdminsResult>;
}
