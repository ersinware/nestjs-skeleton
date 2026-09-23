/**
 * @file port.ts
 * @description Outbound port for ListUsersQuery.
 */

import type { ListUsersResult } from 'src/module/user/application/query/list-users/query';
import type { PaginationParams } from 'src/shared/pagination';
import type { SearchParams } from 'src/shared/search';

/**
 * Dependency injection token representing the {@link IListUsersPort} contract.
 */
export const TOKEN_LIST_USERS_PORT = Symbol();

/**
 * Thin read contract for listing user read-models with pagination and search.
 */
export interface IListUsersPort {
    /**
     * Retrieves a paginated list of non-deleted user read-models.
     *
     * @param params The pagination and search parameters
     * @returns A paginated list of users
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    listUsers(params: SearchParams & PaginationParams): Promise<ListUsersResult>;
}
