/**
 * @file admins.repository.ts
 * @description Implements the admins repository interface using Drizzle ORM. It executes raw SQL queries against the PostgreSQL database to perform CRUD operations on admin entities.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, count, desc } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/common/port/database/database.constant';
import * as schema from 'src/infrastructure/database/schema';
import type { QueryPaginationDto } from 'src/common/pagination/dto/query-pagination.dto';
import type { IAdminsRepository } from '../interface/admins.repository.interface';
import type { Admin, NewAdmin } from '../type/admin.type';

/**
 * Implementation of the admins repository, providing database operations for admin management.
 * Encapsulates the specific query building logic required by Drizzle ORM.
 */
@Injectable()
export class AdminsRepository implements IAdminsRepository {
    /**
     * Injects the Drizzle ORM database instance to execute queries.
     *
     * @param db The Drizzle database instance connection
     */
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase<typeof schema>) {}

    /**
     * Inserts a new admin record into the database.
     *
     * @param data The admin creation payload
     * @returns The created admin entity, or null if the insertion failed
     */
    async create(data: NewAdmin): Promise<Admin | null> {
        return (await this.db.insert(schema.admin).values(data).returning())[0] ?? null;
    }

    /**
     * Retrieves all non-deleted admin records from the database using pagination.
     *
     * @param query The pagination configuration parameters
     * @returns An object containing the array of active admins and their total count
     */
    async findAll(query: QueryPaginationDto): Promise<{ data: Admin[]; total: number }> {
        const conditions = isNull(schema.admin.deletedAt);

        const [data, countResult] = await Promise.all([
            this.db
                .select()
                .from(schema.admin)
                .where(conditions)
                .orderBy(desc(schema.admin.id))
                .limit(query.limit)
                .offset((query.page - 1) * query.limit),
            this.db.select({ total: count() }).from(schema.admin).where(conditions),
        ]);

        return { data, total: countResult[0]?.total ?? 0 };
    }

    /**
     * Finds a single admin record by their unique ID, excluding deleted records.
     *
     * @param id The unique identifier of the admin
     * @returns The matched admin entity, or null if not found
     */
    async findById(id: string): Promise<Admin | null> {
        return (
            (
                await this.db
                    .select()
                    .from(schema.admin)
                    .where(and(eq(schema.admin.id, id), isNull(schema.admin.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Finds a single admin record by their email address, excluding deleted records.
     *
     * @param email The exact email address to search for
     * @returns The matched admin entity, or null if not found
     */
    async findByEmail(email: string): Promise<Admin | null> {
        return (
            (
                await this.db
                    .select()
                    .from(schema.admin)
                    .where(and(eq(schema.admin.email, email), isNull(schema.admin.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Updates an existing admin record with partial data, excluding deleted records.
     *
     * @param id The unique identifier of the admin
     * @param data The partial fields to apply to the record
     * @returns The updated admin entity, or null if the update failed
     */
    async update(id: string, data: Partial<NewAdmin>): Promise<Admin | null> {
        return (
            (
                await this.db
                    .update(schema.admin)
                    .set(data)
                    .where(and(eq(schema.admin.id, id), isNull(schema.admin.deletedAt)))
                    .returning()
            )[0] ?? null
        );
    }

    /**
     * Soft deletes an admin record by their ID, marking it as deleted without removing it from the database.
     *
     * @param id The unique identifier of the admin
     * @returns True if the record was successfully soft-deleted, false otherwise
     */
    async delete(id: string): Promise<boolean> {
        return (
            (
                await this.db
                    .update(schema.admin)
                    .set({ deletedAt: new Date() })
                    .where(and(eq(schema.admin.id, id), isNull(schema.admin.deletedAt)))
                    .returning({ id: schema.admin.id })
            ).length > 0
        );
    }

    /**
     * Permanently removes an admin record from the database.
     *
     * @param id The unique identifier of the admin
     * @returns True if the record was successfully hard-deleted, false otherwise
     */
    async hardDelete(id: string): Promise<boolean> {
        return (
            (await this.db.delete(schema.admin).where(eq(schema.admin.id, id)).returning({ id: schema.admin.id }))
                .length > 0
        );
    }
}
