/**
 * @file database-transaction.storage.ts
 * @description Stores the active Drizzle transaction for the current async call chain.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Active Drizzle transaction for the current async call chain.
 */
export const transactionStorage = new AsyncLocalStorage<Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0]>();
