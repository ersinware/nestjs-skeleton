/**
 * @file handler.ts
 * @description Handles the CheckHealthQuery by invoking health indicators for memory, database, and cache.
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
 * Handler for the GetHealthStatusQuery.
 * Aggregates health status from memory usage, database connection, and cache connection.
 */
@QueryHandler(GetHealthStatusQuery)
export class GetHealthStatusQueryHandler implements IQueryHandler<GetHealthStatusQuery> {
    /**
     * Creates an instance of GetHealthStatusQueryHandler.
     *
     * @param port The port used to execute health checks against the infrastructure.
     */
    constructor(@Inject(TOKEN_GET_HEALTH_STATUS_PORT) private readonly port: IGetHealthStatusPort) {}

    /**
     * Executes the health checks.
     *
     * @returns The aggregated health check result.
     * @throws {ServiceUnavailableException} If one or more health indicators fail; the raw framework exception is deliberately left untranslated (see the adapter).
     */
    async execute(): Promise<GetHealthStatusResult> {
        return this.port.getStatus();
    }
}
