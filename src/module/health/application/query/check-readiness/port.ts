/**
 * @file port.ts
 * @description Outbound port for CheckReadinessQuery.
 */

/**
 * Dependency injection token representing the {@link ICheckReadinessPort} contract.
 */
export const TOKEN_CHECK_READINESS_PORT = Symbol();

/**
 * Thin readiness contract for the probe path.
 */
export interface ICheckReadinessPort {
    /**
     * Runs readiness checks.
     *
     * @throws {ServiceUnavailableException} When any readiness check fails — Terminus's raw exception, deliberately untranslated (see the adapter).
     */
    checkReadiness(): Promise<void>;
}
