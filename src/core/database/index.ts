/**
 * @file index.ts
 * @description Exports the public database contracts and utilities.
 */

export { TOKEN_DATABASE_CLIENT, TOKEN_DATABASE_REPLICA_CLIENT } from 'src/core/database/database-client.token';
export { createDatabasePool } from 'src/core/database/database-pool.factory';
export {
    runInDatabaseTransactionContext,
    runOutsideDatabaseTransaction,
} from 'src/core/database/database-transaction.storage';
export { isUniqueViolation, translateConnectionFailure } from 'src/core/database/driver-error.util';
export { DatabaseModule } from 'src/core/database/module';
export { TOKEN_DATABASE_CLEANER_PORT, type IDatabaseCleanerPort } from 'src/core/database/port/database-cleaner.port';
export {
    TOKEN_DATABASE_HEALTH_PORT,
    TOKEN_DATABASE_REPLICA_HEALTH_PORT,
    type IDatabaseHealthPort,
} from 'src/core/database/port/database-health.port';
export { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database/port/transaction.port';
export { aggregateTimestamps, defaultTimestamps } from 'src/core/database/timestamp-column.util';
