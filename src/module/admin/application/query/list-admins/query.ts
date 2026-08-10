/**
 * @file query.ts
 * @description Query that returns a paginated list of admins.
 */

import { Query } from '@nestjs/cqrs';
import { AdminRole } from 'src/shared/domain/admin';
import { PaginationParams } from 'src/shared/pagination';

/**
 * Retrieves a paginated list of admins.
 */
export class ListAdminsQuery extends Query<ListAdminsResult> {
    /**
     * Initializes the query with its parameters.
     *
     * @param params The pagination parameters
     */
    constructor(readonly params: PaginationParams) {
        super();
    }
}

/**
 * One page of admin read-models plus the total row count for pagination.
 */
export type ListAdminsResult = {
    data: {
        id: string;
        email: string;
        name: string;
        role: AdminRole;
        isBanned: boolean;
    }[];
    total: number;
};
