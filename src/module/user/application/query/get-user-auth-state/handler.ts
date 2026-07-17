/**
 * @file handler.ts
 * @description Handles GetUserAuthStateQuery by fetching the fields required for authentication checks.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException } from 'src/core/exception';
import type { IGetUserAuthStatePort } from 'src/module/user/application/query/get-user-auth-state/port';
import { TOKEN_GET_USER_AUTH_STATE_PORT } from 'src/module/user/application/query/get-user-auth-state/port';
import {
    GetUserAuthStateQuery,
    GetUserAuthStateResult,
} from 'src/module/user/application/query/get-user-auth-state/query';

/**
 * Returns a user's active status and current session version by ID.
 */
@QueryHandler(GetUserAuthStateQuery)
export class GetUserAuthStateQueryHandler implements IQueryHandler<GetUserAuthStateQuery> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_USER_AUTH_STATE_PORT) private readonly port: IGetUserAuthStatePort) {}

    /**
     * Executes the get user auth state query.
     *
     * @param query The query parameters
     * @returns The user's active status and current session version
     * @throws {ResourceNotFoundException} When no user exists with the given ID
     */
    async execute(query: GetUserAuthStateQuery): Promise<GetUserAuthStateResult> {
        const result = await this.port.getAuthState(query.id);

        if (result === null) {
            throw new ResourceNotFoundException();
        }

        return result;
    }
}
