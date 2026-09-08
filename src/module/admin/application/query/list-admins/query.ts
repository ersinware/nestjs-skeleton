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
    readonly data: readonly {
        readonly id: string;
        readonly email: string;
        readonly name: string;
        readonly permissions: readonly Permission[];
        readonly isBanned: boolean;
    }[];
    readonly total: number;
};
