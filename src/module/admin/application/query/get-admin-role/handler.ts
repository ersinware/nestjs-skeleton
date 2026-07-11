/**
 * @file get-admin-role.handler.ts
 * @description Handles GetAdminRoleQuery by fetching the role from the reader port.
 */

import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import {
    TOKEN_GET_ADMIN_ROLE_PORT,
    type IGetAdminRolePort,
} from 'src/module/admin/application/query/get-admin-role/port';
import { GetAdminRoleQuery, type GetAdminRoleResult } from 'src/module/admin/application/query/get-admin-role/query';

/**
 * Handles the execution of GetAdminRoleQuery.
 */
@QueryHandler(GetAdminRoleQuery)
export class GetAdminRoleQueryHandler implements IQueryHandler<GetAdminRoleQuery> {
    /**
     * Injects the outbound port required to fetch the data.
     *
     * @param port Service port to retrieve admin role
     */
    constructor(@Inject(TOKEN_GET_ADMIN_ROLE_PORT) private readonly port: IGetAdminRolePort) {}

    /**
     * Executes the query to retrieve the admin's role.
     * Throws ResourceNotFoundException if the admin cannot be found.
     *
     * @param query The query parameters
     * @returns The admin's role
     */
    async execute(query: GetAdminRoleQuery): Promise<GetAdminRoleResult> {
        const role = await this.port.getRole(query.id);

        if (!role) {
            throw new ResourceNotFoundException();
        }

        return role;
    }
}
