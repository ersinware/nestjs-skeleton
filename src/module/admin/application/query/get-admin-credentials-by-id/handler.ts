/**
 * @file get-admin-credentials-by-id.handler.ts
 * @description Handles GetAdminCredentialsByIdQuery. Returns only the credential fields needed
 * for authentication. Used exclusively internally — never by presentation controllers.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import type { IGetAdminCredentialsByIdPort } from 'src/module/admin/application/query/get-admin-credentials-by-id/port';
import { TOKEN_GET_ADMIN_CREDENTIALS_BY_ID_PORT } from 'src/module/admin/application/query/get-admin-credentials-by-id/port';
import {
    GetAdminCredentialsByIdQuery,
    type GetAdminCredentialsByIdResult,
} from 'src/module/admin/application/query/get-admin-credentials-by-id/query';

/**
 * Returns the minimal credential projection for an admin by ID.
 */
@QueryHandler(GetAdminCredentialsByIdQuery)
export class GetAdminCredentialsByIdQueryHandler implements IQueryHandler<GetAdminCredentialsByIdQuery> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_ADMIN_CREDENTIALS_BY_ID_PORT) private readonly port: IGetAdminCredentialsByIdPort) {}

    /**
     * Executes the get admin credentials by id query.
     *
     * @param query The query parameters
     * @returns The credentials read model
     * @throws {ResourceNotFoundException} When no active admin exists with the given ID.
     */
    async execute(query: GetAdminCredentialsByIdQuery): Promise<GetAdminCredentialsByIdResult> {
        const credentials = await this.port.getCredentialsById(query.id);

        if (!credentials) {
            throw new ResourceNotFoundException();
        }

        return credentials;
    }
}
