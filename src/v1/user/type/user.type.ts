import { users } from 'src/database/schema/users/users.schema';

export type User = typeof users.$inferSelect;

export type NewUser = typeof users.$inferInsert;
