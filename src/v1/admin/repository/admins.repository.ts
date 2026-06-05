/**
 * @file admins.repository.ts
 * @description Repository implementation for Admin entity persistence operations using Drizzle ORM.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/database/constant/database.constant';
import * as schema from 'src/database/schema';
import type { IAdminsRepository } from '../interface/admins.repository.interface';
import type { Admin, NewAdmin } from '../type/admin.type';

/**
 * Implementation of the admins repository, providing database operations for admin management.
 */
@Injectable()
export class AdminsRepository implements IAdminsRepository {
    /**
     * Creates an instance of AdminsRepository.
     *
     * @param db Drizzle database instance injected using token TOKEN_DATABASE.
     */
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase<typeof schema>) {}

    /**
     * Inserts a new admin record into the database.
     *
     * @param data Admin creation fields.
     * @returns A promise resolving to the created admin, or null if insert failed.
     */
    async create(data: NewAdmin): Promise<Admin | null> {
        return (await this.db.insert(schema.admins).values(data).returning())[0] ?? null;
    }

    /**
     * Retrieves all non-deleted admin records from the database.
     *
     * @returns A promise resolving to an array of all active admins.
     */
    async findAll(): Promise<Admin[]> {
        return this.db.select().from(schema.admins).where(isNull(schema.admins.deletedAt));
    }

    /**
     * Finds a single admin record by their ID where they are not deleted.
     *
     * @param id The admin ID.
     * @returns A promise resolving to the admin or null if not found.
     */
    async findById(id: string): Promise<Admin | null> {
        return (
            (
                await this.db
                    .select()
                    .from(schema.admins)
                    .where(and(eq(schema.admins.id, id), isNull(schema.admins.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Finds a single admin record by their email address where they are not deleted.
     *
     * @param email The admin email address.
     * @returns A promise resolving to the admin or null if not found.
     */
    async findByEmail(email: string): Promise<Admin | null> {
        return (
            (
                await this.db
                    .select()
                    .from(schema.admins)
                    .where(and(eq(schema.admins.email, email), isNull(schema.admins.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Updates an existing admin record with partial data where they are not deleted.
     * If data is empty, returns the current record without executing an update query.
     *
     * @param id The admin ID.
     * @param data Partial fields to update.
     * @returns A promise resolving to the updated admin, or null if update failed.
     */
    async update(id: string, data: Partial<NewAdmin>): Promise<Admin | null> {
        if (Object.keys(data).length === 0) {
            return this.findById(id);
        }

        return (
            (
                await this.db
                    .update(schema.admins)
                    .set(data)
                    .where(and(eq(schema.admins.id, id), isNull(schema.admins.deletedAt)))
                    .returning()
            )[0] ?? null
        );
    }

    /**
     * Deletes an admin record by their ID (Soft Delete).
     *
     * @param id The admin ID.
     * @returns A promise resolving to true if the record was soft-deleted, false otherwise.
     */
    async delete(id: string): Promise<boolean> {
        return (
            (
                await this.db
                    .update(schema.admins)
                    .set({ deletedAt: new Date() })
                    .where(and(eq(schema.admins.id, id), isNull(schema.admins.deletedAt)))
                    .returning({ id: schema.admins.id })
            ).length > 0
        );
    }
}
