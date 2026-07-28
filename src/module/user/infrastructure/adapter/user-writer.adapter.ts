/**
 * @file user-writer.adapter.ts
 * @description The Drizzle ORM implementation of the user writer port. Handles mapping between domain aggregates and database models for write operations.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { InferSelectModel } from 'drizzle-orm';
import { and, eq, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE_CLIENT, isUniqueViolation } from 'src/core/database';
import { TOKEN_EVENT_BUS_PORT, type IEventBusPort } from 'src/core/event-bus';
import type { IUserWriterPort } from 'src/module/user/application/command/port/user-writer.port';
import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { user as userSchema } from 'src/module/user/infrastructure/user.schema';
import { ResourceConflictException, ResourceConflictMessage } from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

/**
 * Drizzle ORM implementation of the IUserWriterPort.
 * Handles persistence and reconstitution of the User aggregate root.
 */
@Injectable()
export class UserWriterAdapter implements IUserWriterPort {
    /**
     * Initializes the user repository with the database connection.
     *
     * @param db The PostgresJs database instance
     * @param eventBusPort The in-process bus the aggregate's domain events are dispatched on
     */
    constructor(
        @Inject(TOKEN_DATABASE_CLIENT) private readonly db: PostgresJsDatabase,
        @Inject(TOKEN_EVENT_BUS_PORT) private readonly eventBusPort: IEventBusPort,
    ) {}

    /**
     * Maps a database row to the User aggregate root.
     */
    private mapToDomain(row: InferSelectModel<typeof userSchema>): User {
        return User.reconstitute(row.id, row.deletedAt, {
            email: row.email,
            name: row.name,
            password: row.password,
            isBanned: row.isBanned,
            version: row.version,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        });
    }

    /**
     * Loads a specific user aggregate by its unique identifier for mutation.
     *
     * @param id The unique identifier of the target user
     * @returns The user aggregate root, or null if no active user is found
     */
    async load(id: string): Promise<User | null> {
        const row = (
            await this.db
                .select()
                .from(userSchema)
                .where(and(eq(userSchema.id, id), isNull(userSchema.deletedAt)))
                .limit(1)
        )[0];

        return row ? this.mapToDomain(row) : null;
    }

    /**
     * Saves a User aggregate to the database, then dispatches the domain events it accumulated.
     *
     * @param user The User aggregate root to save
     * @throws {ResourceConflictException} if the email address is already taken
     */
    async save(user: User) {
        const payload = user.toSnapshot();

        try {
            await this.db
                .insert(userSchema)
                .values(payload)
                .onConflictDoUpdate({
                    target: userSchema.id,
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

        this.publishDomainEvents(user);
    }

    /**
     * Pulls the aggregate's accumulated domain events and dispatches them on the in-process bus.
     * Emitted after the row is written so a listener that re-reads the user observes the new state.
     *
     * Dispatch is fire-and-forget: the write is the caller's contract, so a failing listener must not
     * fail the command that already persisted the row. A rejected dispatch is swallowed; the flows
     * that matter reconcile through authoritative reads (refresh reads the version from the DB).
     *
     * @param user The aggregate whose domain events are dispatched
     */
    private publishDomainEvents(user: User) {
        for (const event of user.pullDomainEvents()) {
            // The catch only stops an unhandled rejection from crashing the process.
            this.eventBusPort
                .emitAsync(event.type, { aggregateId: event.aggregateId, eventId: uuidv7() })
                .catch(() => {});
        }
    }
}
