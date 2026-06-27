/**
 * @file users.repository.ts
 * @description The Drizzle ORM implementation of the users repository interface. Handles constructing and executing raw SQL queries securely.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, count, desc, or, ilike } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/common/port/database/database.constant';
import * as schema from 'src/infrastructure/database/schema';
import type { QuerySearchDto } from 'src/common/search/dto/query-search.dto';
import type { IUsersRepository } from '../interface/users.repository.interface';
import type { NewUser, User } from '../type/user.type';

/**
 * The concrete repository implementation for the user domain.
 * Abstracts SQL dialects and driver nuances behind the Drizzle query builder.
 */
@Injectable()
export class UsersRepository implements IUsersRepository {
    /**
     * Injects the Drizzle ORM database instance for executing queries.
     *
     * @param db The configured database connection
     */
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase<typeof schema>) {}

    /**
     * Inserts a new user record into the database and returns the inserted row.
     *
     * @param data The payload containing fields required to insert a user
     * @returns The created user entity, or null if the insertion fails
     */
    async create(data: NewUser): Promise<User | null> {
        return (await this.db.insert(schema.user).values(data).returning())[0] ?? null;
    }

    /**
     * Executes a paginated query against the database to fetch non-deleted users.
     * Conditionally applies ILIKE filters on name or email if a search term is provided.
     *
     * @param query The pagination limits and search parameters
     * @returns An object containing the array of user entities and the total record count
     */
    async findAll(query: QuerySearchDto): Promise<{ data: User[]; total: number }> {
        let conditions = isNull(schema.user.deletedAt);

        if (query.search) {
            const searchPattern = `%${query.search}%`,
                searchFilter = or(ilike(schema.user.name, searchPattern), ilike(schema.user.email, searchPattern));

            if (searchFilter) {
                conditions = and(conditions, searchFilter)!;
            }
        }

        const [data, countResult] = await Promise.all([
            this.db
                .select()
                .from(schema.user)
                .where(conditions)
                .orderBy(desc(schema.user.id))
                .limit(query.limit)
                .offset((query.page - 1) * query.limit),
            this.db.select({ total: count() }).from(schema.user).where(conditions),
        ]);

        return { data, total: countResult[0]?.total ?? 0 };
    }

    /**
     * Executes a query to find a specific user by their unique identifier, omitting deleted accounts.
     *
     * @param id The unique identifier of the target user
     * @returns The user entity, or null if no active user is found
     */
    async findById(id: string): Promise<User | null> {
        return (
            (
                await this.db
                    .select()
                    .from(schema.user)
                    .where(and(eq(schema.user.id, id), isNull(schema.user.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Executes a query to find a specific user by their exact email address, omitting deleted accounts.
     *
     * @param email The exact email address to query
     * @returns The user entity, or null if no active user is found
     */
    async findByEmail(email: string): Promise<User | null> {
        return (
            (
                await this.db
                    .select()
                    .from(schema.user)
                    .where(and(eq(schema.user.email, email), isNull(schema.user.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Executes a focused query to retrieve only the hashed password column for credential verification.
     *
     * @param id The unique identifier of the target user
     * @returns The hashed password string, or null if the user does not exist or is deleted
     */
    async findPasswordById(id: string): Promise<string | null> {
        return (
            (
                await this.db
                    .select({ password: schema.user.password })
                    .from(schema.user)
                    .where(and(eq(schema.user.id, id), isNull(schema.user.deletedAt)))
                    .limit(1)
            )[0]?.password ?? null
        );
    }

    /**
     * Executes a partial update on a specific user, returning the mutated record.
     *
     * @param id The unique identifier of the user to update
     * @param data The payload containing the fields to update
     * @returns The updated user entity, or null if the update fails
     */
    async update(id: string, data: Partial<NewUser>): Promise<User | null> {
        return (
            (
                await this.db
                    .update(schema.user)
                    .set(data)
                    .where(and(eq(schema.user.id, id), isNull(schema.user.deletedAt)))
                    .returning()
            )[0] ?? null
        );
    }

    /**
     * Executes a soft-delete by populating the deletion timestamp column for a specific user.
     *
     * @param id The unique identifier of the user to delete
     * @returns True if the soft-delete was successful, false otherwise
     */
    async delete(id: string): Promise<boolean> {
        return (
            (
                await this.db
                    .update(schema.user)
                    .set({ deletedAt: new Date() })
                    .where(and(eq(schema.user.id, id), isNull(schema.user.deletedAt)))
                    .returning({ id: schema.user.id })
            ).length > 0
        );
    }
}
