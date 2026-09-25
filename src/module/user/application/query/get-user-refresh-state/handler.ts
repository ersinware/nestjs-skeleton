/**
 * @file handler.ts
 * @description Handles GetUserRefreshStateQuery by fetching claims for an eligible refresh.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IGetUserRefreshStatePort } from 'src/module/user/application/query/get-user-refresh-state/port';
import { TOKEN_GET_USER_REFRESH_STATE_PORT } from 'src/module/user/application/query/get-user-refresh-state/port';
import {
    GetUserRefreshStateQuery,
    GetUserRefreshStateResult,
} from 'src/module/user/application/query/get-user-refresh-state/query';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Returns current claims for an account eligible to refresh the supplied token version.
 */
@QueryHandler(GetUserRefreshStateQuery)
export class GetUserRefreshStateQueryHandler implements IQueryHandler<
    GetUserRefreshStateQuery,
    GetUserRefreshStateResult
> {
    /**
     * Initializes the handler with the required port.
     *
     * @param port The port used to execute the query
     */
    constructor(@Inject(TOKEN_GET_USER_REFRESH_STATE_PORT) private readonly port: IGetUserRefreshStatePort) {}

    /**
     * Executes the refresh eligibility query.
     *
     * @param query The query parameters
     * @returns Current token claims for the eligible account
     * @throws {ResourceNotFoundException} When the account is missing, deleted, banned, or the token version is revoked
     * @throws {DependencyUnavailableException} When the account database is unavailable
     */
    async execute(query: GetUserRefreshStateQuery): Promise<GetUserRefreshStateResult> {
        const result = await this.port.getRefreshState(query.id, query.tokenSessionVersion);

        if (!result) {
            throw new ResourceNotFoundException();
        }

        return result;
    }
}
