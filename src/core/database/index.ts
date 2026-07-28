/**
 * @file index.ts
 * @description Public entry point of the database concern; nothing outside may import past this
 * barrel. Adapters are deliberately not exported: the module binds them to their ports, so consumers
 * reach only the contract surface, never an adapter class.
 */

export * from 'src/core/database/database-client.token';
export * from 'src/core/database/driver-error.util';
export * from 'src/core/database/module';
export * from 'src/core/database/port/database-cleaner.port';
export * from 'src/core/database/port/database-health.port';
export * from 'src/core/database/timestamp-column.util';
