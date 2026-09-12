/**
 * @file port.ts
 * @description Outbound port for CheckReadinessQuery.
 */

/**
 * Dependency injection token representing the {@link ICheckReadinessPort} contract.
 */
export const TOKEN_CHECK_READINESS_PORT = Symbol('TOKEN_CHECK_READINESS_PORT');

/**
 * Thin readiness contract for the probe path.
 */
export interface ICheckReadinessPort {
    /**
     * Runs readiness checks.
     *
     * @returns Resolves when readiness checks pass.
     * @throws {ServiceUnavailableException} When any readiness check fails — Terminus's raw exception, deliberately untranslated (see the adapter).
     */
    checkReadiness(): Promise<void>;
}
