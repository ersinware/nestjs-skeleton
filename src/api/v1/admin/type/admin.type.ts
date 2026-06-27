/**
 * @file admin.type.ts
 * @description Defines the TypeScript types for the Admin entity. By deriving these types directly from the Drizzle ORM schema, the application guarantees exact type parity with the database structure at compile time.
 */

import { admin } from 'src/infrastructure/database/schema/admin/admin.schema';

/**
 * Represents the structure of an Admin record retrieved from the database.
 * Used extensively in services and controllers to strongly type the fetched entity.
 */
export type Admin = typeof admin.$inferSelect;

/**
 * Represents the structure of an Admin record to be inserted into the database.
 * Allows omitting auto-generated fields like IDs and timestamps during creation.
 */
export type NewAdmin = typeof admin.$inferInsert;
