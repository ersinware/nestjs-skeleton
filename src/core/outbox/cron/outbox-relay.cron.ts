/**
 * @file outbox-relay.cron.ts
 * @description Cron job that polls the outbox table and relays pending events to the queue.
 */

import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactionStorage } from 'src/core/database';
import { TOKEN_DATABASE } from 'src/core/database/constant';
import { LogPayload } from 'src/core/observability';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_EXCEPTION_TRACKER_PORT, type IExceptionTrackerPort } from 'src/core/observability/tracker';
import { OutboxStatus } from 'src/core/outbox/enum';
import { TOKEN_OUTBOX_QUEUE_PORT, type IOutboxQueuePort } from 'src/core/outbox/port/outbox-queue.port';
import { TOKEN_OUTBOX_PORT, type IOutboxPort } from 'src/core/outbox/port/outbox.port';

/**
 * A scheduled cron job responsible for polling the outbox table and relaying pending events
 * to the BullMQ outbox queue for processing.
 */
@Injectable()
export class OutboxRelayCron {
    private isProcessing = false;

    /**
     * Creates an instance of OutboxRelayCron.
     *
     * @param db - The database instance for transactions.
     * @param outboxPort - The port used to interact with outbox persistence (database).
     * @param outboxQueuePort - The port used to interact with the message queue.
     */
    constructor(
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
        @Inject(TOKEN_EXCEPTION_TRACKER_PORT) private readonly exceptionTrackerPort: IExceptionTrackerPort,
        @Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase,
        @Inject(TOKEN_OUTBOX_PORT) private readonly outboxPort: IOutboxPort,
        @Inject(TOKEN_OUTBOX_QUEUE_PORT) private readonly outboxQueuePort: IOutboxQueuePort,
    ) {}

    /**
     * Periodically executes the outbox relay process.
     * Fetches pending events within a transaction, adds them to the queue, and marks them as queued.
     *
     * @throws Throws if database operations or queue insertions fail.
     */
    @Cron(CronExpression.EVERY_5_MINUTES)
    async handleCron() {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;

        try {
            let hasMore = true;

            while (hasMore) {
                await this.db.transaction(async (tx) => {
                    await transactionStorage.run(tx, async () => {
                        const pendingEvents = await this.outboxPort.getPendingEvents(50);

                        if (pendingEvents.length === 0) {
                            hasMore = false;

                            return;
                        }

                        await this.outboxQueuePort.queueEvents(pendingEvents);
                        await this.outboxPort.updateStatus(
                            pendingEvents.map((e) => e.id),
                            OutboxStatus.QUEUED,
                        );
                    });
                });
            }
        } catch (error) {
            this.loggerPort.error(
                new LogPayload({
                    class: OutboxRelayCron.name,
                    method: this.handleCron.name,
                    error,
                }),
            );
            this.exceptionTrackerPort.captureException(error);
        } finally {
            this.isProcessing = false;
        }
    }
}
