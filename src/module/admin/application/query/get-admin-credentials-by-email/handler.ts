/**
 * @file get-admin-credentials-by-email.handler.ts
 * @description Handles GetAdminCredentialsByEmailQuery. Returns only the credential fields needed
 * for authentication. Used exclusively internally — never by presentation controllers.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IGetAdminCredentialsByEmailPort } from 'src/module/admin/application/query/get-admin-credentials-by-email/port';
import { TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT } from 'src/module/admin/application/query/get-admin-credentials-by-email/port';
import {
    GetAdminCredentialsByEmailQuery,
    type GetAdminCredentialsByEmailResult,
} from 'src/module/admin/application/query/get-admin-credentials-by-email/query';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Returns the minimal credential projection for an admin by email address.
 */
@QueryHandler(GetAdminCredentialsByEmailQuery)
export class GetAdminCredentialsByEmailQueryHandler implements IQueryHandler<GetAdminCredentialsByEmailQuery> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(
        @Inject(TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT) private readonly port: IGetAdminCredentialsByEmailPort,
    ) {}

    /**
     * Executes the get admin credentials by email query.
     *
     * @param query The query parameters
     * @returns The credentials read model
     * @throws {ResourceNotFoundException} When no active admin exists with the given email.
     */
    async execute(query: GetAdminCredentialsByEmailQuery): Promise<GetAdminCredentialsByEmailResult> {
        const credentials = await this.port.getCredentialsByEmail(query.email);

        if (!credentials) {
            throw new ResourceNotFoundException();
        }

        return credentials;
    }
}
