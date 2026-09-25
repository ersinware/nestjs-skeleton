/**
 * @file handler.ts
 * @description Handler for GetAdminRefreshStateQuery.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IGetAdminRefreshStatePort } from 'src/module/admin/application/query/get-admin-refresh-state/port';
import { TOKEN_GET_ADMIN_REFRESH_STATE_PORT } from 'src/module/admin/application/query/get-admin-refresh-state/port';
import {
    GetAdminRefreshStateQuery,
    GetAdminRefreshStateResult,
} from 'src/module/admin/application/query/get-admin-refresh-state/query';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Returns current claims for an account eligible to refresh the supplied token version.
 */
@QueryHandler(GetAdminRefreshStateQuery)
export class GetAdminRefreshStateQueryHandler implements IQueryHandler<
    GetAdminRefreshStateQuery,
    GetAdminRefreshStateResult
> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_ADMIN_REFRESH_STATE_PORT) private readonly port: IGetAdminRefreshStatePort) {}

    /**
     * Executes the query.
     *
     * @param query The query parameters
     * @returns Current token claims for the eligible account
     * @throws {ResourceNotFoundException} When the account is missing, deleted, banned, or the token version is revoked
     * @throws {DependencyUnavailableException} When the account database is unavailable
     */
    async execute(query: GetAdminRefreshStateQuery): Promise<GetAdminRefreshStateResult> {
        const result = await this.port.getRefreshState(query.id, query.tokenSessionVersion);

        if (!result) {
            throw new ResourceNotFoundException();
        }

        return result;
    }
}
