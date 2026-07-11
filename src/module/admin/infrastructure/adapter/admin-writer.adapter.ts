/**
 * @file admin-writer.adapter.ts
 * @description The Drizzle ORM implementation of the admins repository interface. Handles mapping between domain and database models.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { InferSelectModel } from 'drizzle-orm';
import { and, eq, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/core/database';
import type { IAdminWriterPort } from 'src/module/admin/application/command/port';
import { Admin } from 'src/module/admin/domain/aggregate';
import { admin as adminSchema } from 'src/module/admin/infrastructure/database/schema';

/**
 * Drizzle ORM implementation of the IAdminWriterPort.
 * Handles persistence and reconstitution of the Admin aggregate root.
 */
@Injectable()
export class AdminWriterAdapter implements IAdminWriterPort {
    /**
     * Initializes the admin repository with the database connection.
     *
     * @param db The PostgresJs database instance
     */
    constructor(@Inject(TOKEN_DATABASE) readonly db: PostgresJsDatabase) {}

    /**
     * Maps a database row to the Admin aggregate root.
     */
    private mapToDomain(row: InferSelectModel<typeof adminSchema>): Admin {
        return Admin.reconstitute(row.id, {
            email: row.email,
            name: row.name,
            password: row.password,
            role: row.role,
            isActive: row.isActive,
            deletedAt: row.deletedAt,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        });
    }

    /**
     * Loads a specific admin aggregate by its unique identifier for mutation.
     *
     * @param id The unique identifier of the target admin
     * @returns The admin aggregate root, or null if no active admin is found
     */
    async load(id: string): Promise<Admin | null> {
        const row = (
            await this.db
                .select()
                .from(adminSchema)
                .where(and(eq(adminSchema.id, id), isNull(adminSchema.deletedAt)))
                .limit(1)
        )[0];

        return row ? this.mapToDomain(row) : null;
    }

    /**
     * Saves an Admin aggregate to the database.
     * Upserts the entity using a transaction.
     *
     * @param admin The Admin aggregate root to save
     */
    async save(admin: Admin) {
        const payload = admin.toSnapshot();

        await this.db
            .insert(adminSchema)
            .values(payload)
            .onConflictDoUpdate({
                target: adminSchema.id,
                set: {
                    ...payload,
                    id: undefined,
                    createdAt: undefined,
                },
            });
    }
}
