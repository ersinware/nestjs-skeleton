/**
 * @file admin.type.ts
 * @description TypeScript type definitions for the Admin entity derived from Drizzle ORM schemas.
 */

import { admins } from 'src/database/schema/admins/admins.schema';

/**
 * Represents the structure of an Admin record retrieved from the database.
 */
export type Admin = typeof admins.$inferSelect;

/**
 * Represents the structure of an Admin record to be inserted into the database.
 */
export type NewAdmin = typeof admins.$inferInsert;
