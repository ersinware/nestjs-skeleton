/**
 * @file admin-writer.adapter.ts
 * @description Drizzle implementation of the admin writer port.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_CLIENT, isUniqueViolation, translateConnectionFailure } from 'src/core/database';
import { TOKEN_JOB_QUEUE_WRITER_PORT, type IJobQueueWriterPort } from 'src/core/job-queue';
import type { IAdminWriterPort } from 'src/module/admin/application/command/port/admin-writer.port';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { admin as adminSchema } from 'src/module/admin/infrastructure/admin.schema';
import { ResourceConflictException, ResourceConflictMessage } from 'src/shared/exception';

/**
 * Loads and saves Admin aggregates and persists their jobs in the same transaction.
 */
@Injectable()
export class AdminWriterAdapter implements IAdminWriterPort {
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
     * Loads an admin aggregate for mutation.
     *
     * @param id The unique identifier of the target admin
     * @returns The aggregate, or null when no non-deleted admin exists
     */
    async load(id: string): Promise<Admin | null> {
        try {
            const row = (
                await this.database
                    .select()
                    .from(adminSchema)
                    .where(and(eq(adminSchema.id, id), isNull(adminSchema.deletedAt)))
                    .limit(1)
            )[0];

            return row ? Admin.reconstitute(row) : null;
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Upserts the aggregate under the optimistic lock and queues its jobs in the caller's transaction.
     *
     * @param admin The aggregate to save
     */
    async save(admin: Admin) {
        const snapshot = admin.toSnapshot();

        let affected: number | null;

        try {
            // One conditional upsert covers both paths: a new aggregate inserts at version 0; an
            // existing one updates only while the row still carries the loaded version, storing it
            // incremented. A stale aggregate matches neither branch and affects no row.
            affected = (
                await this.database
                    .insert(adminSchema)
                    .values(snapshot)
                    .onConflictDoUpdate({
                        target: adminSchema.id,
                        set: {
                            ...snapshot,
                            id: undefined,
                            createdAt: undefined,
                            version: snapshot.version + 1,
                        },
                        setWhere: eq(adminSchema.version, snapshot.version),
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

        await this.jobQueueWriterPort.enqueue(admin.pullJobs());
    }
}
