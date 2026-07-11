/**
 * @file list-admins.handler.ts
 * @description Handles ListAdminsQuery by delegating the paginated fetch to the reader port.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IListAdminsPort } from 'src/module/admin/application/query/list-admins/port';
import { TOKEN_LIST_ADMINS_PORT } from 'src/module/admin/application/query/list-admins/port';
import { ListAdminsQuery, type ListAdminsResult } from 'src/module/admin/application/query/list-admins/query';

/**
 * Returns a paginated list of public admin read-models.
 */
@QueryHandler(ListAdminsQuery)
export class ListAdminsQueryHandler implements IQueryHandler<ListAdminsQuery> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_LIST_ADMINS_PORT) private readonly port: IListAdminsPort) {}

    /**
     * Executes the list admins query.
     *
     * @param query The query containing pagination parameters
     * @returns A paginated list of admins
     */
    async execute(query: ListAdminsQuery): Promise<ListAdminsResult> {
        return this.port.listAdmins(query.query);
    }
}
