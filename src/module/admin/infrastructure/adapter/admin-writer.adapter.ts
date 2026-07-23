/**
 * @file admin-writer.adapter.ts
 * @description The Drizzle ORM implementation of the admins repository interface. Handles mapping between domain and database models.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { InferSelectModel } from 'drizzle-orm';
import { and, eq, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE, isUniqueViolation } from 'src/core/database';
import { TOKEN_EVENT_BUS_PORT, type IEventBusPort } from 'src/core/event-bus';
import type { IAdminWriterPort } from 'src/module/admin/application/command/port/admin-writer.port';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { admin as adminSchema } from 'src/module/admin/infrastructure/admin.schema';
import { ResourceConflictException, ResourceConflictMessage } from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

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
     * @param eventBusPort The in-process bus the aggregate's domain events are dispatched on
     */
    constructor(
        @Inject(TOKEN_DATABASE) readonly db: PostgresJsDatabase,
        @Inject(TOKEN_EVENT_BUS_PORT) private readonly eventBusPort: IEventBusPort,
    ) {}

    /**
     * Maps a database row to the Admin aggregate root.
     */
    private mapToDomain(row: InferSelectModel<typeof adminSchema>): Admin {
        return Admin.reconstitute(row.id, row.deletedAt, {
            email: row.email,
            name: row.name,
            password: row.password,
            role: row.role,
            isBanned: row.isBanned,
            version: row.version,
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
     * Saves an Admin aggregate to the database, then dispatches the domain events it accumulated.
     *
     * @param admin The Admin aggregate root to save
     * @throws {ResourceConflictException} if the email address is already taken
     */
    async save(admin: Admin) {
        const payload = admin.toSnapshot();

        try {
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
        } catch (error) {
            // The id conflict is absorbed by onConflictDoUpdate and email is this table's only other
            // unique constraint, so a unique violation here can only mean the address is taken.
            if (isUniqueViolation(error)) {
                throw new ResourceConflictException(ResourceConflictMessage.EMAIL_IN_USE, { cause: error });
            }

            throw error;
        }

        this.publishDomainEvents(admin);
    }

    /**
     * Dispatches the aggregate's accumulated domain events on the in-process bus and then clears them.
     * Emitted after the row is written so a listener that re-reads the admin observes the new state.
     *
     * Dispatch is fire-and-forget: the write is the caller's contract, so a failing listener must not
     * fail the command that already persisted the row. A rejected dispatch is swallowed; the flows
     * that matter reconcile through authoritative reads (refresh reads the version from the DB).
     *
     * @param admin The aggregate whose domain events are dispatched
     */
    private publishDomainEvents(admin: Admin) {
        for (const event of admin.domainEvents) {
            // The catch only stops an unhandled rejection from crashing the process.
            this.eventBusPort
                .emitAsync(event.type, { aggregateId: event.aggregateId, eventId: uuidv7() })
                .catch(() => {});
        }

        admin.clearDomainEvents();
    }
}
