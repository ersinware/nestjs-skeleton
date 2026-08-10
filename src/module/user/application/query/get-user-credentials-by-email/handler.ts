/**
 * @file handler.ts
 * @description Handles GetUserCredentialsByEmailQuery. Returns only the credential fields needed
 * for authentication. Used exclusively internally.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IGetUserCredentialsByEmailPort } from 'src/module/user/application/query/get-user-credentials-by-email/port';
import { TOKEN_GET_USER_CREDENTIALS_BY_EMAIL_PORT } from 'src/module/user/application/query/get-user-credentials-by-email/port';
import {
    GetUserCredentialsByEmailQuery,
    type GetUserCredentialsByEmailResult,
} from 'src/module/user/application/query/get-user-credentials-by-email/query';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Returns the minimal credential projection for a user by email address.
 */
@QueryHandler(GetUserCredentialsByEmailQuery)
export class GetUserCredentialsByEmailQueryHandler implements IQueryHandler<
    GetUserCredentialsByEmailQuery,
    GetUserCredentialsByEmailResult
> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(
        @Inject(TOKEN_GET_USER_CREDENTIALS_BY_EMAIL_PORT) private readonly port: IGetUserCredentialsByEmailPort,
    ) {}

    /**
     * Executes the get user credentials by email query.
     *
     * @param query The query parameters
     * @returns The credentials read model
     * @throws {ResourceNotFoundException} When no active user exists with the given email
     */
    async execute(query: GetUserCredentialsByEmailQuery): Promise<GetUserCredentialsByEmailResult> {
        const credentials = await this.port.getCredentialsByEmail(query.email);

        if (!credentials) {
            throw new ResourceNotFoundException();
        }

        return credentials;
    }
}
