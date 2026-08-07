/**
 * @file port.ts
 * @description Outbound port for GetHealthStatusQuery.
 */

import type { GetHealthStatusResult } from 'src/module/health/application/query/get-health-status/query';

/**
 * Dependency injection token representing the {@link IGetHealthStatusPort} contract.
 */
export const TOKEN_GET_HEALTH_STATUS_PORT = Symbol('TOKEN_GET_HEALTH_STATUS_PORT');

/**
 * Thin read contract for the per-indicator health report of every dependency.
 */
export interface IGetHealthStatusPort {
    /**
     * Runs every health check and returns the combined report.
     *
     * @returns The health report; resolves only when all indicators pass.
     * @throws {ServiceUnavailableException} When any indicator fails — Terminus's raw exception, deliberately untranslated (see the adapter).
     */
    getStatus(): Promise<GetHealthStatusResult>;
}
