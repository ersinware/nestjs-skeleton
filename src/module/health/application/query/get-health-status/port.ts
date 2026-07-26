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
     * @throws {ServiceUnavailableException} If one or more health indicators fail; the raw framework exception is deliberately left untranslated (see the adapter).
     */
    getStatus(): Promise<GetHealthStatusResult>;
}
