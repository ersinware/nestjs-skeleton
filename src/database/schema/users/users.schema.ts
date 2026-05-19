import { boolean, index, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { timestamps } from '../base.schema';

export const users = pgTable(
    'users',
    {
        id: serial('id').notNull().primaryKey(),
        email: text('email').notNull().unique(),
        name: text('name').notNull(),
        password: text('password').notNull(),
        isActive: boolean('is_active').notNull().default(true),
        ...timestamps,
    },
    (table) => [index('users_created_at_idx').on(table.createdAt)],
);
