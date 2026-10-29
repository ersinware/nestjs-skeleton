/**
 * @file database-transaction-context.ts
 * @description Provides ambient access to the active Drizzle database executor.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Database executor scoped to the current async call chain.
 */
export const transactionStorage = new AsyncLocalStorage<
    NodePgDatabase | Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0]
>();

/**
 * Runs work with the supplied executor in the ambient database context.
 *
 * @param transaction Database executor bound to the open transaction
 * @param work Work that must use the transaction through the primary database proxy
 * @returns The work result
 */
export function runInDatabaseTransactionContext<T>(transaction: NodePgDatabase, work: () => Promise<T>): Promise<T> {
    return transactionStorage.run(transaction, work);
}

/**
 * Runs independently committed refusal evidence outside a mutation's ambient transaction.
 *
 * @param work The audit write that must survive rollback of the rejected operation
 * @returns The independently committed write result
 */
export function runOutsideDatabaseTransaction<T>(work: () => Promise<T>): Promise<T> {
    return transactionStorage.exit(work);
}
