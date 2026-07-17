/**
 * @file list-admins.query.ts
 * @description Query that returns a paginated list of all admins.
 */

import { Query } from '@nestjs/cqrs';
import { AdminRole } from 'src/shared/domain/admin';
import { PaginationParams } from 'src/shared/pagination';

/**
 * Query to retrieve a paginated list of all admins.
 */
export class ListAdminsQuery extends Query<ListAdminsResult> {
    /**
     * Initializes the query with its parameters.
     *
     * @param query The pagination parameters
     */
    constructor(readonly query: PaginationParams) {
        super();
    }
}

/**
 * The expected result of the ListAdminsQuery, which is a paginated list of admins.
 */
export type ListAdminsResult = {
    data: {
        id: string;
        email: string;
        name: string;
        role: AdminRole;
        isBanned: boolean;
        createdAt: Date;
        updatedAt: Date;
    }[];
    total: number;
};
