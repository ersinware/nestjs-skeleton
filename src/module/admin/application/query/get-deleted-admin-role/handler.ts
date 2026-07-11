/**
 * @file handler.ts
 * @description Handles GetDeletedAdminRoleQuery to fetch a deleted admin's role.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import type { IGetDeletedAdminRolePort } from 'src/module/admin/application/query/get-deleted-admin-role/port';
import { TOKEN_GET_DELETED_ADMIN_ROLE_PORT } from 'src/module/admin/application/query/get-deleted-admin-role/port';
import {
    GetDeletedAdminRoleQuery,
    type GetDeletedAdminRoleResult,
} from 'src/module/admin/application/query/get-deleted-admin-role/query';

/**
 * Handles the retrieval of a soft-deleted admin's role.
 */
@QueryHandler(GetDeletedAdminRoleQuery)
export class GetDeletedAdminRoleQueryHandler implements IQueryHandler<GetDeletedAdminRoleQuery> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_DELETED_ADMIN_ROLE_PORT) private readonly port: IGetDeletedAdminRolePort) {}

    /**
     * Executes the query to get the deleted admin role.
     *
     * @param query The query parameters
     * @returns The admin role result
     * @throws {ResourceNotFoundException} When the admin does not exist.
     */
    async execute(query: GetDeletedAdminRoleQuery): Promise<GetDeletedAdminRoleResult> {
        const role = await this.port.getDeletedAdminRole(query.id);

        if (!role) {
            throw new ResourceNotFoundException();
        }

        return role;
    }
}
