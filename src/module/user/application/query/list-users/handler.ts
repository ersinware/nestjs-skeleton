/**
 * @file handler.ts
 * @description Handles ListUsersQuery. Returns paginated list projections from the query
 * repository.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IListUsersPort } from 'src/module/user/application/query/list-users/port';
import { TOKEN_LIST_USERS_PORT } from 'src/module/user/application/query/list-users/port';
import { ListUsersQuery, type ListUsersResult } from 'src/module/user/application/query/list-users/query';

/**
 * Returns a paginated list of public user read-models.
 */
@QueryHandler(ListUsersQuery)
export class ListUsersQueryHandler implements IQueryHandler<ListUsersQuery> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_LIST_USERS_PORT) private readonly port: IListUsersPort) {}

    /**
     * Executes the list users query.
     *
     * @param query The query containing pagination parameters
     * @returns A paginated list of users
     */
    async execute(query: ListUsersQuery): Promise<ListUsersResult> {
        return this.port.listUsers(query.params);
    }
}
