/**
 * @file port.ts
 * @description Outbound port for ListUsersQuery.
 */

import type { ListUsersResult } from 'src/module/user/application/query/list-users/query';
import type { PaginationParams } from 'src/shared/pagination';
import type { SearchParams } from 'src/shared/search';

export const TOKEN_LIST_USERS_PORT = Symbol('TOKEN_LIST_USERS_PORT');

export interface IListUsersPort {
    /**
     * Retrieves a paginated list of non-deleted user read-models.
     *
     * @param params The pagination and search parameters
     * @returns A paginated list of users
     */
    listUsers(params: SearchParams & PaginationParams): Promise<ListUsersResult>;
}
