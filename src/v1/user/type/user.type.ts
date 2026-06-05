/**
 * @file user.type.ts
 * @description TypeScript type definitions for the User entity derived from Drizzle ORM schemas.
 */

import { users } from 'src/database/schema/users/users.schema';

/**
 * Represents the structure of a User record retrieved from the database.
 */
export type User = typeof users.$inferSelect;

/**
 * Represents the structure of a User record to be inserted into the database.
 */
export type NewUser = typeof users.$inferInsert;
