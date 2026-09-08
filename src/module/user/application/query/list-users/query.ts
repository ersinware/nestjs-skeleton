/**
 * @file query.ts
 * @description Query that resolves a paginated list of user profiles.
 */

import { Query } from '@nestjs/cqrs';
import type { Permission } from 'src/shared/domain/principal';
import type { PaginationParams } from 'src/shared/pagination';
import type { SearchParams } from 'src/shared/search';

/**
 * Fetches a paginated list of public user projections.
 */
export class ListUsersQuery extends Query<ListUsersResult> {
    /**
     * Initializes the query with its parameters.
     *
     * @param params The pagination limits and search parameters
     */
    constructor(readonly params: SearchParams & PaginationParams) {
        super();
    }
}

/**
 * The expected result of the ListUsersQuery, wrapping items in a paginated response.
 */
export type ListUsersResult = {
    readonly data: readonly {
        readonly id: string;
        readonly email: string;
        readonly name: string;
        readonly permissions: readonly Permission[];
        readonly isBanned: boolean;
    }[];
    readonly total: number;
};
