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
    /**
     * Account read models in the requested page.
     */
    readonly data: readonly {
        /**
         * Identifier of the account represented by this row.
         */
        readonly id: string;

        /**
         * Current email address of the account.
         */
        readonly email: string;

        /**
         * Display name of the account.
         */
        readonly name: string;

        /**
         * Current attached avatar object key.
         */
        readonly avatarKey: string;

        /**
         * Permissions currently assigned to the account.
         */
        readonly permissions: readonly Permission[];

        /**
         * Whether the account is barred from authentication.
         */
        readonly isBanned: boolean;
    }[];

    /**
     * Total matching accounts across all pages.
     */
    readonly total: number;
};
