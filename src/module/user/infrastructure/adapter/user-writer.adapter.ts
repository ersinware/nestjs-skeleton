/**
 * @file user-writer.adapter.ts
 * @description The Drizzle ORM implementation of the user writer port. Handles mapping between domain aggregates and database models for write operations.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { InferSelectModel } from 'drizzle-orm';
import { and, eq, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/core/database';
import { TOKEN_EVENT_BUS_PORT, type IEventBusPort } from 'src/core/event-bus';
import { LogPayload } from 'src/core/observability';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import type { IUserWriterPort } from 'src/module/user/application/command/port';
import { User } from 'src/module/user/domain/aggregate';
import { user as userSchema } from 'src/module/user/infrastructure/database/schema';
import { uuidv7 } from 'uuidv7';

@Injectable()
export class UserWriterAdapter implements IUserWriterPort {
    /**
     * Initializes the user repository with the database connection.
     *
     * @param db The PostgresJs database instance
     * @param eventBusPort The in-process bus the aggregate's domain events are dispatched on
     * @param loggerPort The port used to record a dispatch that no listener chain completed
     */
    constructor(
        @Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase,
        @Inject(TOKEN_EVENT_BUS_PORT) private readonly eventBusPort: IEventBusPort,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
    ) {}

    /**
     * Maps a database row to the User aggregate root.
     */
    private mapToDomain(row: InferSelectModel<typeof userSchema>): User {
        return User.reconstitute(row.id, {
            email: row.email,
            name: row.name,
            password: row.password,
            isBanned: row.isBanned,
            deletedAt: row.deletedAt,
            version: row.version,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        });
    }

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
     */
    async save(user: User) {
        const payload = user.toSnapshot();

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

        // TODO
        this.publishDomainEvents(user);
    }

    /**
     * Dispatches the aggregate's accumulated domain events on the in-process bus and then clears them.
     * Emitted after the row is written so a listener that re-reads the user observes the new state.
     *
     * Dispatch is fire-and-forget: the write is the caller's contract, so a failing listener must not
     * fail the command that already persisted the row. Until the outbox returns there is no delivery
     * guarantee behind this — a rejected dispatch is a permanently dropped event, so it is logged
     * rather than swallowed, since nothing else would reveal the gap.
     *
     * @param user The aggregate whose domain events are dispatched
     */
    private publishDomainEvents(user: User) {
        for (const event of user.domainEvents) {
            this.eventBusPort
                .emitAsync(event.type, { aggregateId: event.aggregateId, eventId: uuidv7() })
                .catch((error: unknown) =>
                    this.loggerPort.error(
                        new LogPayload({
                            class: UserWriterAdapter.name,
                            method: this.publishDomainEvents.name,
                            error,
                            type: event.type,
                            aggregateId: event.aggregateId,
                        }),
                    ),
                );
        }

        user.clearDomainEvents();
    }
}
