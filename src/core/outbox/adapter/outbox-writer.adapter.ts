/**
 * @file outbox-writer.adapter.ts
 * @description Persists pg-boss jobs through the ambient Drizzle transaction.
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import { TOKEN_OUTBOX_CLIENT } from 'src/core/outbox/outbox-client.token';
import type { OutboxEvent } from 'src/core/outbox/outbox-event';
import { OUTBOX_QUEUE } from 'src/core/outbox/outbox-queue';
import type { IOutboxWriterPort } from 'src/core/outbox/port/outbox-writer.port';
import { SystemException } from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

/**
 * Uses the primary proxy so job inserts participate in the caller's transaction.
 */
@Injectable()
export class OutboxWriterAdapter implements IOutboxWriterPort {
    /**
     * Connects enqueueing to the application transaction rather than the worker pool.
     *
     * @param db Primary Drizzle proxy
     * @param boss Initialized queue client
     */
    constructor(
        @Inject(TOKEN_DATABASE_CLIENT) private readonly db: NodePgDatabase,
        @Inject(TOKEN_OUTBOX_CLIENT) private readonly boss: PgBoss,
    ) {}

    /**
     * Enqueues events in one batch without publishing before commit.
     *
     * @param events Event routing names and aggregates to re-read
     */
    async save(...events: readonly OutboxEvent[]) {
        if (events.length === 0) {
            return;
        }

        try {
            const jobIds = await this.boss.insert(
                OUTBOX_QUEUE,
                events.map((event) => ({ id: uuidv7(), data: event })),
                { db: fromDrizzle(this.db, sql), returnId: true },
            );

            if (jobIds === null || jobIds.length !== events.length) {
                throw new SystemException('The outbox events were not all accepted by the queue.');
            }
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }
}
