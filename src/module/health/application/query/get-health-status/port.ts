/**
 * @file port.ts
 * @description Outbound port for GetHealthStatusQuery.
 */

import type { GetHealthStatusResult } from 'src/module/health/application/query/get-health-status/query';

export const TOKEN_GET_HEALTH_STATUS_PORT = Symbol('TOKEN_GET_HEALTH_STATUS_PORT');

export interface IGetHealthStatusPort {
    /**
     * Executes the health checks.
     *
     * @returns A promise resolving to the health check result.
     * @throws {Error} If the health check execution encounters a critical failure.
     */
    getStatus(): Promise<GetHealthStatusResult>;
}
