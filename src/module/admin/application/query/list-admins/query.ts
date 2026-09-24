/**
 * @file query.ts
 * @description Query that returns a paginated list of admins.
 */

import { Query } from '@nestjs/cqrs';
import type { Permission } from 'src/shared/domain/principal';
import { PaginationParams } from 'src/shared/pagination';
import type { SearchParams } from 'src/shared/search';

/**
 * Retrieves a paginated list of admins.
 */
export class ListAdminsQuery extends Query<ListAdminsResult> {
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
 * One page of admin read-models plus the total row count for pagination.
 */
export type ListAdminsResult = {
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
         * Permissions currently assigned to the account.
         */
        readonly permissions: readonly Permission[];

        /**
         * Whether the account is barred from authentication.
         */
        readonly isBanned: boolean;

        /**
         * Whether the admin has completed activation.
         */
        readonly isActivated: boolean;
    }[];

    /**
     * Total matching accounts across all pages.
     */
    readonly total: number;
};
