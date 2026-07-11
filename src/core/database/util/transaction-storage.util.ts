import { AsyncLocalStorage } from 'async_hooks';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export const transactionStorage = new AsyncLocalStorage<PostgresJsDatabase>();
