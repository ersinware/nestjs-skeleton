/**
 * @file handler.ts
 * @description Handles GetFreshAdminByIdQuery through the primary reader port.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IGetFreshAdminByIdPort } from 'src/module/admin/application/query/get-fresh-admin-by-id/port';
import { TOKEN_GET_FRESH_ADMIN_BY_ID_PORT } from 'src/module/admin/application/query/get-fresh-admin-by-id/port';
import {
    GetFreshAdminByIdQuery,
    type GetFreshAdminByIdResult,
} from 'src/module/admin/application/query/get-fresh-admin-by-id/query';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Returns the current public admin read-model without caching.
 */
@QueryHandler(GetFreshAdminByIdQuery)
export class GetFreshAdminByIdQueryHandler implements IQueryHandler<GetFreshAdminByIdQuery, GetFreshAdminByIdResult> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_FRESH_ADMIN_BY_ID_PORT) private readonly port: IGetFreshAdminByIdPort) {}

    /**
     * Executes the get admin by ID query.
     *
     * @param query The query parameters containing the ID
     * @returns The admin profile read model
     * @throws {ResourceNotFoundException} When no non-deleted admin exists with the given ID
     * @throws {DependencyUnavailableException} When the account database is unavailable
     */
    async execute(query: GetFreshAdminByIdQuery): Promise<GetFreshAdminByIdResult> {
        const admin = await this.port.getById(query.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        return admin;
    }
}
