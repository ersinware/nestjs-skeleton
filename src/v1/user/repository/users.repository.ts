/**
 * @file users.repository.ts
 * @description Repository implementation for User entity persistence operations using Drizzle ORM.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/database/constant/database.constant';
import * as schema from 'src/database/schema';
import type { IUsersRepository } from '../interface/users.repository.interface';
import type { NewUser, User } from '../type/user.type';

/**
 * Implementation of the users repository, providing database operations for user management.
 */
@Injectable()
export class UsersRepository implements IUsersRepository {
    /**
     * Creates an instance of UsersRepository.
     *
     * @param db Drizzle database instance injected using token TOKEN_DATABASE.
     */
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase<typeof schema>) {}

    /**
     * Inserts a new user record into the database.
     *
     * @param data User creation fields.
     * @returns A promise resolving to the created user, or null if insert failed.
     */
    async create(data: NewUser): Promise<User | null> {
        return (await this.db.insert(schema.users).values(data).returning())[0] ?? null;
    }

    /**
     * Retrieves all non-deleted user records from the database.
     *
     * @returns A promise resolving to an array of all active users.
     */
    async findAll(): Promise<User[]> {
        return this.db.select().from(schema.users).where(isNull(schema.users.deletedAt));
    }

    /**
     * Finds a single user record by their ID where they are not deleted.
     *
     * @param id The user ID.
     * @returns A promise resolving to the user or null if not found.
     */
    async findById(id: string): Promise<User | null> {
        return (
            (
                await this.db
                    .select()
                    .from(schema.users)
                    .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Finds a single user record by their email address where they are not deleted.
     *
     * @param email The user email address.
     * @returns A promise resolving to the user or null if not found.
     */
    async findByEmail(email: string): Promise<User | null> {
        return (
            (
                await this.db
                    .select()
                    .from(schema.users)
                    .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Retrieves the hashed password of a user by their ID where they are not deleted.
     *
     * @param id The user ID.
     * @returns A promise resolving to the hashed password string, or null if not found.
     */
    async findPasswordById(id: string): Promise<string | null> {
        return (
            (
                await this.db
                    .select({ password: schema.users.password })
                    .from(schema.users)
                    .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
                    .limit(1)
            )[0]?.password ?? null
        );
    }

    /**
     * Updates an existing user record with partial data where they are not deleted.
     * If data is empty, returns the current record without executing an update query.
     *
     * @param id The user ID.
     * @param data Partial fields to update.
     * @returns A promise resolving to the updated user, or null if update failed.
     */
    async update(id: string, data: Partial<NewUser>): Promise<User | null> {
        if (Object.keys(data).length === 0) {
            return this.findById(id);
        }

        return (
            (
                await this.db
                    .update(schema.users)
                    .set(data)
                    .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
                    .returning()
            )[0] ?? null
        );
    }

    /**
     * Deletes a user record by their ID (Soft delete - sets deletedAt).
     *
     * @param id The user ID.
     * @returns A promise resolving to true if the record was soft-deleted, false otherwise.
     */
    async delete(id: string): Promise<boolean> {
        return (
            (
                await this.db
                    .update(schema.users)
                    .set({ deletedAt: new Date() })
                    .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
                    .returning({ id: schema.users.id })
            ).length > 0
        );
    }
}
