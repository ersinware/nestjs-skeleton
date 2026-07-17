/**
 * @file handler.ts
 * @description Handles GetAdminAuthStateQuery by fetching the fields required for authentication checks.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import type { IGetAdminAuthStatePort } from 'src/module/admin/application/query/get-admin-auth-state/port';
import { TOKEN_GET_ADMIN_AUTH_STATE_PORT } from 'src/module/admin/application/query/get-admin-auth-state/port';
import {
    GetAdminAuthStateQuery,
    GetAdminAuthStateResult,
} from 'src/module/admin/application/query/get-admin-auth-state/query';

/**
 * Returns an admin's active status and current session version by ID.
 */
@QueryHandler(GetAdminAuthStateQuery)
export class GetAdminAuthStateQueryHandler implements IQueryHandler<GetAdminAuthStateQuery> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_ADMIN_AUTH_STATE_PORT) private readonly port: IGetAdminAuthStatePort) {}

    /**
     * Executes the get admin auth state query.
     *
     * @param query The query parameters
     * @returns The admin's active status and current session version
     * @throws {ResourceNotFoundException} When no admin exists with the given ID.
     */
    async execute(query: GetAdminAuthStateQuery): Promise<GetAdminAuthStateResult> {
        const result = await this.port.getAuthState(query.id);

        if (result === null) {
            throw new ResourceNotFoundException();
        }

        return result;
    }
}
