/**
 * @file transaction.port.ts
 * @description Application contract for atomic database writes.
 */

/**
 * Dependency injection token for {@link ITransactionPort}.
 */
export const TOKEN_TRANSACTION_PORT = Symbol();

/**
 * Runs database-only callbacks without exposing the driver to application handlers.
 * Await all database work and propagate failures to the transaction owner. No automatic retry.
 */
export interface ITransactionPort {
    /**
     * Opens a primary transaction and waits for commit before resolving.
     * Rejects an ambient transaction instead of joining it or opening an independent one.
     *
     * @param work Awaited database work
     * @returns Callback result after commit completes
     * @throws {SystemException} When a transaction is already active
     * @throws {DependencyUnavailableException} When the database connection fails
     */
    start<T>(work: () => Promise<T>): Promise<T>;

    /**
     * Joins the active primary transaction without savepoints or committing it.
     * Resolution guarantees only callback completion, never transaction commit.
     * Do not perform external side effects after this call; they cannot be rolled back
     * with the transaction. Persist follow-up jobs in the transaction instead.
     *
     * @param work Awaited database work
     * @returns Callback result before the transaction owner commits
     * @throws {SystemException} When no transaction is active
     * @throws {DependencyUnavailableException} When the database connection fails
     */
    join<T>(work: () => Promise<T>): Promise<T>;
}
