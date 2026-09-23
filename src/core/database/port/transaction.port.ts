/**
 * @file transaction.port.ts
 * @description Application contract for atomic database writes.
 */

/**
 * Dependency injection token for {@link ITransactionPort}.
 */
export const TOKEN_TRANSACTION_PORT = Symbol();

/**
 * Runs database work without exposing the driver to application handlers.
 */
export interface ITransactionPort {
    /**
     * Runs the callback in a primary transaction; nested calls join it without savepoints.
     * Await all DB work and propagate errors to roll back. Keep queries inside the callback;
     * do not include network calls or cross-context mutations. No automatic retry.
     *
     * @param work Awaited database work
     * @returns Callback result; only the outer call waits for commit
     * @throws {DependencyUnavailableException} When the database connection fails
     */
    run<T>(work: () => Promise<T>): Promise<T>;
}
