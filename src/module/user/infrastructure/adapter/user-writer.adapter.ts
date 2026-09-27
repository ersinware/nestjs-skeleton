/**
 * @file user-writer.adapter.ts
 * @description Drizzle implementation of the user writer port.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_CLIENT, isUniqueViolation, translateConnectionFailure } from 'src/core/database';
import { TOKEN_JOB_QUEUE_WRITER_PORT, type IJobQueueWriterPort } from 'src/core/job-queue';
import type { IUserWriterPort } from 'src/module/user/application/command/port/user-writer.port';
import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { user as userSchema } from 'src/module/user/infrastructure/user.schema';
import { ResourceConflictException, ResourceConflictMessage } from 'src/shared/exception';

/**
 * Loads and saves User aggregates and persists their jobs in the same transaction.
 */
@Injectable()
export class UserWriterAdapter implements IUserWriterPort {
    /**
     * Initializes the adapter with the required persistence dependencies.
     *
     * @param database The Drizzle database client
     * @param jobQueueWriterPort Persists jobs atomically with the aggregate
     */
    constructor(
        @Inject(TOKEN_DATABASE_CLIENT) private readonly database: NodePgDatabase,
        @Inject(TOKEN_JOB_QUEUE_WRITER_PORT) private readonly jobQueueWriterPort: IJobQueueWriterPort,
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
                await this.database
                    .select()
                    .from(userSchema)
                    .where(and(eq(userSchema.id, id), isNull(userSchema.deletedAt)))
                    .limit(1)
            )[0];

            return row ? User.reconstitute(row) : null;
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Loads a non-deleted user aggregate by exact normalized email for mutation.
     *
     * @param email The normalized account email address
     * @returns The user aggregate root, or null if no live user is found
     */
    async loadByEmail(email: string): Promise<User | null> {
        try {
            const row = (
                await this.database
                    .select()
                    .from(userSchema)
                    .where(and(eq(userSchema.email, email), isNull(userSchema.deletedAt)))
                    .limit(1)
            )[0];

            return row ? User.reconstitute(row) : null;
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Upserts the aggregate under the optimistic lock and queues its jobs in the caller's transaction.
     *
     * @param user The aggregate to save
     */
    async save(user: User) {
        const snapshot = user.toSnapshot();

        let affected: number | null;

        try {
            // One conditional upsert covers both paths: a new aggregate inserts at version 0; an
            // existing one updates only while the row still carries the loaded version, storing it
            // incremented. A stale aggregate matches neither branch and affects no row.
            affected = (
                await this.database
                    .insert(userSchema)
                    .values(snapshot)
                    .onConflictDoUpdate({
                        target: userSchema.id,
                        set: {
                            ...snapshot,
                            id: undefined,
                            createdAt: undefined,
                            version: snapshot.version + 1,
                        },
                        setWhere: eq(userSchema.version, snapshot.version),
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

        await this.jobQueueWriterPort.enqueue(user.pullJobs());
    }
}
