/**
 * @file query.ts
 * @description Query object for fetching the role of a deleted admin.
 */

import { Query } from '@nestjs/cqrs';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * Defines the query to retrieve the role of a soft-deleted admin account.
 * This is an internal query used strictly by event listeners to clean up
 * sessions and state for deleted users, where standard queries would return null.
 */
export class GetDeletedAdminRoleQuery extends Query<GetDeletedAdminRoleResult> {
    /**
     * Initializes the check deleted admin role query.
     *
     * @param id The unique identifier of the soft-deleted admin
     */
    constructor(readonly id: string) {
        super();
    }
}

/**
 * The expected result of the GetDeletedAdminRoleQuery.
 */
export type GetDeletedAdminRoleResult = AdminRole;
