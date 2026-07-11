/**
 * @file handler.ts
 * @description Handles GetUserCredentialsByIdQuery. Returns only the credential fields needed
 * for authentication. Used exclusively internally.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import type { IGetUserCredentialsByIdPort } from 'src/module/user/application/query/get-user-credentials-by-id/port';
import { TOKEN_GET_USER_CREDENTIALS_BY_ID_PORT } from 'src/module/user/application/query/get-user-credentials-by-id/port';
import {
    GetUserCredentialsByIdQuery,
    type GetUserCredentialsByIdResult,
} from 'src/module/user/application/query/get-user-credentials-by-id/query';

/**
 * Returns the minimal credential projection for a user by ID.
 */
@QueryHandler(GetUserCredentialsByIdQuery)
export class GetUserCredentialsByIdQueryHandler implements IQueryHandler<GetUserCredentialsByIdQuery> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_USER_CREDENTIALS_BY_ID_PORT) private readonly port: IGetUserCredentialsByIdPort) {}

    /**
     * Executes the get user credentials by id query.
     *
     * @param query The query parameters
     * @returns The credentials read model
     * @throws {ResourceNotFoundException} When no active user exists with the given ID
     */
    async execute(query: GetUserCredentialsByIdQuery): Promise<GetUserCredentialsByIdResult> {
        const credentials = await this.port.getCredentialsById(query.id);

        if (!credentials) {
            throw new ResourceNotFoundException();
        }

        return credentials;
    }
}
