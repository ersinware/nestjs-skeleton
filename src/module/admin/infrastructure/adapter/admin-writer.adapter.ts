/**
 * @file admin-writer.adapter.ts
 * @description Drizzle implementation of the admin writer port.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { InferSelectModel } from 'drizzle-orm';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_CLIENT, isUniqueViolation, translateConnectionFailure } from 'src/core/database';
import { TOKEN_EVENT_PUBLISHER_PORT, type IEventPublisherPort } from 'src/core/event-bus';
import type { IAdminWriterPort } from 'src/module/admin/application/command/port/admin-writer.port';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { admin as adminSchema } from 'src/module/admin/infrastructure/admin.schema';
import { ResourceConflictException, ResourceConflictMessage } from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

/**
 * Persists and reconstitutes the Admin aggregate, translating driver errors at the port boundary
 * and dispatching the aggregate's domain events after the write.
 */
@Injectable()
export class AdminWriterAdapter implements IAdminWriterPort {
    /**
     * Injects the database connection and the event publisher.
     *
     * @param db The Drizzle database client
     * @param eventPublisherPort The port the aggregate's domain events are dispatched through
     */
    constructor(
        @Inject(TOKEN_DATABASE_CLIENT) private readonly db: NodePgDatabase,
        @Inject(TOKEN_EVENT_PUBLISHER_PORT) private readonly eventPublisherPort: IEventPublisherPort,
    ) {}

    /**
     * Loads an admin aggregate for mutation.
     *
     * @param id The unique identifier of the target admin
     * @returns The aggregate, or null when no non-deleted admin exists
     */
    async load(id: string): Promise<Admin | null> {
        try {
            const row = (
                await this.db
                    .select()
                    .from(adminSchema)
                    .where(and(eq(adminSchema.id, id), isNull(adminSchema.deletedAt)))
                    .limit(1)
            )[0];

            return row ? this.mapToDomain(row) : null;
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Upserts the aggregate's snapshot, then dispatches the domain events it accumulated.
     *
     * @param admin The aggregate to save
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

            throw translateConnectionFailure(error);
        }

        this.publishDomainEvents(admin);
    }

    /**
     * Maps a database row to the Admin aggregate root.
     */
    private mapToDomain(row: InferSelectModel<typeof adminSchema>): Admin {
        return Admin.reconstitute({
            id: row.id,
            email: row.email,
            name: row.name,
            password: row.password,
            permissions: row.permissions,
            isBanned: row.isBanned,
            deletedAt: row.deletedAt,
            sessionVersion: row.sessionVersion,
            revocationVersion: row.revocationVersion,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        });
    }

    /**
     * Dispatches the aggregate's accumulated domain events, after the row is written so a listener
     * that re-reads the admin observes the new state. Fire-and-forget: a failing listener must not
     * fail the command that already persisted the row.
     *
     * @param admin The aggregate whose domain events are dispatched
     */
    private publishDomainEvents(admin: Admin) {
        for (const event of admin.pullDomainEvents()) {
            this.eventPublisherPort
                .emitAsync(event.type, { aggregateId: event.aggregateId, eventId: uuidv7() })
                .catch(() => {});
        }
    }
}
