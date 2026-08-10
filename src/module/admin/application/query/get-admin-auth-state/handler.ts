/**
 * @file handler.ts
 * @description Handler for GetAdminAuthStateQuery.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IGetAdminAuthStatePort } from 'src/module/admin/application/query/get-admin-auth-state/port';
import { TOKEN_GET_ADMIN_AUTH_STATE_PORT } from 'src/module/admin/application/query/get-admin-auth-state/port';
import {
    GetAdminAuthStateQuery,
    GetAdminAuthStateResult,
} from 'src/module/admin/application/query/get-admin-auth-state/query';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Returns an admin's ban status and current session version.
 */
@QueryHandler(GetAdminAuthStateQuery)
export class GetAdminAuthStateQueryHandler implements IQueryHandler<GetAdminAuthStateQuery, GetAdminAuthStateResult> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_ADMIN_AUTH_STATE_PORT) private readonly port: IGetAdminAuthStatePort) {}

    /**
     * Executes the query.
     *
     * @param query The query parameters
     * @returns The admin's ban status and current session version
     * @throws {ResourceNotFoundException} When no active admin exists with the given ID.
     */
    async execute(query: GetAdminAuthStateQuery): Promise<GetAdminAuthStateResult> {
        const result = await this.port.getAuthState(query.id);

        if (!result) {
            throw new ResourceNotFoundException();
        }

        return result;
    }
}
