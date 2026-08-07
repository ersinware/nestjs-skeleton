/**
 * @file handler.ts
 * @description Handles the GetHealthStatusQuery through the health read port.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { IGetHealthStatusPort } from 'src/module/health/application/query/get-health-status/port';
import { TOKEN_GET_HEALTH_STATUS_PORT } from 'src/module/health/application/query/get-health-status/port';
import {
    GetHealthStatusQuery,
    GetHealthStatusResult,
} from 'src/module/health/application/query/get-health-status/query';

/**
 * Resolves the GetHealthStatusQuery by delegating to the health read port.
 */
@QueryHandler(GetHealthStatusQuery)
export class GetHealthStatusQueryHandler implements IQueryHandler<GetHealthStatusQuery, GetHealthStatusResult> {
    /**
     * Creates the handler.
     *
     * @param port The read port executing the health checks.
     */
    constructor(@Inject(TOKEN_GET_HEALTH_STATUS_PORT) private readonly port: IGetHealthStatusPort) {}

    /**
     * Executes the query.
     *
     * @returns The health report.
     */
    async execute(): Promise<GetHealthStatusResult> {
        return this.port.getStatus();
    }
}
