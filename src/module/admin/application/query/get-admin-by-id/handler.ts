/**
 * @file get-admin-by-id.handler.ts
 * @description Handles GetAdminByIdQuery by fetching the admin from the reader port.
 * Validates existence and throws an exception if the admin is soft-deleted or entirely missing.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import type { IGetAdminByIdPort } from 'src/module/admin/application/query/get-admin-by-id/port';
import { TOKEN_GET_ADMIN_BY_ID_PORT } from 'src/module/admin/application/query/get-admin-by-id/port';
import { GetAdminByIdQuery, type GetAdminByIdResult } from 'src/module/admin/application/query/get-admin-by-id/query';

/**
 * Returns the public admin read-model by ID.
 */
@QueryHandler(GetAdminByIdQuery)
export class GetAdminByIdQueryHandler implements IQueryHandler<GetAdminByIdQuery> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_ADMIN_BY_ID_PORT) private readonly port: IGetAdminByIdPort) {}

    /**
     * Executes the get admin by ID query.
     *
     * @param query The query parameters containing the ID
     * @returns The admin profile read model
     * @throws {ResourceNotFoundException} When no active admin exists with the given ID.
     */
    async execute(query: GetAdminByIdQuery): Promise<GetAdminByIdResult> {
        const admin = await this.port.getById(query.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        return admin;
    }
}
