/**
 * @file query.ts
 * @description Query that resolves a paginated list of user profiles.
 */

import { Query } from '@nestjs/cqrs';
import type { PaginationParams } from 'src/shared/pagination';
import type { SearchParams } from 'src/shared/search';

/**
 * Fetches a paginated list of public user projections.
 */
export class ListUsersQuery extends Query<ListUsersResult> {
    /**
     * Initializes the query with its parameters.
     *
     * @param query The pagination limits and search parameters
     */
    constructor(readonly params: SearchParams & PaginationParams) {
        super();
    }
}

/**
 * The expected result of the ListUsersQuery, wrapping items in a paginated response.
 */
export type ListUsersResult = {
    data: {
        id: string;
        email: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }[];
    total: number;
};
