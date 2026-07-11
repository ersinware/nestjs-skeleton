/**
 * @file query.ts
 * @description Defines the query model for retrieving an admin's role.
 */

import { Query } from '@nestjs/cqrs';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * Query to request the role of a specific administrator.
 */
export class GetAdminRoleQuery extends Query<GetAdminRoleResult> {
    /**
     * Initializes the GetAdminRoleQuery.
     *
     * @param id The ID of the admin
     */
    constructor(readonly id: string) {
        super();
    }
}

/**
 * The expected result of the GetAdminRoleQuery.
 */
export type GetAdminRoleResult = AdminRole;
