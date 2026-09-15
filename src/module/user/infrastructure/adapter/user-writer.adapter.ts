/**
 * @file user-writer.adapter.ts
 * @description Drizzle implementation of the user writer port.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { InferSelectModel } from 'drizzle-orm';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_CLIENT, isUniqueViolation, translateConnectionFailure } from 'src/core/database';
import { TOKEN_EVENT_PUBLISHER_PORT, type IEventPublisherPort } from 'src/core/event-bus';
import type { IUserWriterPort } from 'src/module/user/application/command/port/user-writer.port';
import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { user as userSchema } from 'src/module/user/infrastructure/user.schema';
import { ResourceConflictException, ResourceConflictMessage } from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

/**
 * Persists and reconstitutes the User aggregate, translating driver errors at the port boundary
 * and dispatching the aggregate's domain events after the write.
 */
@Injectable()
export class UserWriterAdapter implements IUserWriterPort {
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
     * Loads a specific user aggregate by its unique identifier for mutation.
     *
     * @param id The unique identifier of the target user
     * @returns The user aggregate root, or null if no active user is found
     */
    async load(id: string): Promise<User | null> {
        try {
            const row = (
                await this.db
                    .select()
                    .from(userSchema)
                    .where(and(eq(userSchema.id, id), isNull(userSchema.deletedAt)))
                    .limit(1)
            )[0];

            return row ? this.mapToDomain(row) : null;
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Upserts the aggregate's snapshot under the optimistic lock, then dispatches the domain events
     * it accumulated.
     *
     * @param user The aggregate to save
     */
    async save(user: User) {
        const payload = user.toSnapshot();

        let affected: number | null;

        try {
            // One conditional upsert covers both paths: a new aggregate inserts at version 0; an
            // existing one updates only while the row still carries the loaded version, storing it
            // incremented. A stale aggregate matches neither branch and affects no row.
            affected = (
                await this.db
                    .insert(userSchema)
                    .values(payload)
                    .onConflictDoUpdate({
                        target: userSchema.id,
                        set: {
                            ...payload,
                            id: undefined,
                            createdAt: undefined,
                            version: payload.version + 1,
                        },
                        setWhere: eq(userSchema.version, payload.version),
                    })
            ).rowCount;
        } catch (error) {
            // The id conflict is absorbed by onConflictDoUpdate and email is this table's only other
            // unique constraint, so a unique violation here can only mean the address is taken.
            if (isUniqueViolation(error)) {
                throw new ResourceConflictException(ResourceConflictMessage.EMAIL_IN_USE, { cause: error });
            }

            throw translateConnectionFailure(error);
        }

        // The optimistic lock refused: another request wrote the row between this handler's load
        // and save, so its decision was made on stale state and must not overwrite the newer one.
        if (affected === 0) {
            throw new ResourceConflictException(ResourceConflictMessage.CONCURRENT_MODIFICATION);
        }

        this.publishDomainEvents(user);
    }

    /**
     * Maps a database row to the User aggregate root.
     */
    private mapToDomain(row: InferSelectModel<typeof userSchema>): User {
        return User.reconstitute({
            id: row.id,
            version: row.version,
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
     * Dispatches after SQL succeeds without awaiting listeners. An outer transaction may still
     * roll back; listener failures are suppressed and delivery is not retried.
     *
     * @param user The aggregate whose domain events are dispatched
     */
    private publishDomainEvents(user: User) {
        for (const event of user.pullDomainEvents()) {
            this.eventPublisherPort
                .emitAsync(event.type, { aggregateId: event.aggregateId, eventId: uuidv7() })
                .catch(() => {});
        }
    }
}
