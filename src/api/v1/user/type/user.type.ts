/**
 * @file user.type.ts
 * @description Provides strictly typed aliases for the User entity inferred directly from the Drizzle ORM schema, ensuring end-to-end type safety between the database and the application logic.
 */

import { user } from 'src/infrastructure/database/schema/user/user.schema';

/**
 * Represents the complete structure of a User record as retrieved from the database.
 * Includes auto-generated fields like IDs and timestamps.
 */
export type User = typeof user.$inferSelect;

/**
 * Represents the structure of a User record when inserting a new row into the database.
 * Omits auto-generated or default fields that are handled by the database engine.
 */
export type NewUser = typeof user.$inferInsert;
