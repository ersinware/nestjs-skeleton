/**
 * @file handler.ts
 * @description Handler for ListAdminsQuery.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IListAdminsPort } from 'src/module/admin/application/query/list-admins/port';
import { TOKEN_LIST_ADMINS_PORT } from 'src/module/admin/application/query/list-admins/port';
import { ListAdminsQuery, type ListAdminsResult } from 'src/module/admin/application/query/list-admins/query';

/**
 * Returns a paginated list of admin read-models.
 */
@QueryHandler(ListAdminsQuery)
export class ListAdminsQueryHandler implements IQueryHandler<ListAdminsQuery, ListAdminsResult> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_LIST_ADMINS_PORT) private readonly port: IListAdminsPort) {}

    /**
     * Executes the query.
     *
     * @param query The query carrying the pagination parameters
     * @returns The paginated list of admins
     */
    async execute(query: ListAdminsQuery): Promise<ListAdminsResult> {
        return this.port.listAdmins(query.params);
    }
}
