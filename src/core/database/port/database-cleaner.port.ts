/**
 * @file database-cleaner.port.ts
 * @description Outbound port for wiping database state between test runs.
 */

/**
 * Dependency injection token representing the {@link IDatabaseCleanerPort} contract.
 */
export const TOKEN_DATABASE_CLEANER_PORT = Symbol();

/**
 * Outbound port for resetting all application-owned database tables. Test-only: resolved from the
 * container by the E2E suite, never injected by application code.
 */
export interface IDatabaseCleanerPort {
    /**
     * Truncates every application-owned table so each test run starts from an empty database.
     *
     * @throws {Error} The raw driver error when the truncation fails.
     */
    cleanup(): Promise<void>;
}
