/**
 * @file index.ts
 * @description Public entry point of the database concern. Nothing outside may import past this barrel.
 */

export { TOKEN_DATABASE_CLIENT } from 'src/core/database/database-client.token';
export { isUniqueViolation, translateConnectionFailure } from 'src/core/database/driver-error.util';
export { DatabaseModule } from 'src/core/database/module';
export { TOKEN_DATABASE_CLEANER_PORT, type IDatabaseCleanerPort } from 'src/core/database/port/database-cleaner.port';
export { TOKEN_DATABASE_HEALTH_PORT, type IDatabaseHealthPort } from 'src/core/database/port/database-health.port';
export { aggregateTimestamps, defaultTimestamps } from 'src/core/database/timestamp-column.util';
