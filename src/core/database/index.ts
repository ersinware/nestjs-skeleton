/**
 * @file index.ts
 * @description Public entry point of the database concern. Nothing outside may import past this barrel.
 * Adapters are deliberately NOT exported: they are bound to their ports inside the module, so a
 * consumer can only reach the contract surface — never an adapter class.
 */

export * from 'src/core/database/base.schema';
export * from 'src/core/database/database-client.token';
export * from 'src/core/database/driver-error';
export * from 'src/core/database/module';
export * from 'src/core/database/port/database-cleaner.port';
export * from 'src/core/database/port/database-health.port';
