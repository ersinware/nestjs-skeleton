/**
 * @file job-queue-database.adapter.ts
 * @description Adapts the job-queue PostgreSQL pool for pg-boss and Drizzle transactions.
 */

import { Injectable } from '@nestjs/common';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import type { Db } from 'pg-boss';
import { JobQueueNotificationSubscription } from 'src/core/job-queue/job-queue-notification-subscription';
import { JobQueueTransaction } from 'src/core/job-queue/job-queue-transaction';
import type { ILoggerPort } from 'src/core/observability/logger';
import { SystemException } from 'src/shared/exception';

/**
 * Provides pg-boss SQL access and exposes worker transactions to Drizzle-backed adapters.
 */
@Injectable()
export class JobQueueDatabaseAdapter implements Db {
    /**
     * Initializes the adapter with the dedicated queue pool.
     *
     * @param pool Dedicated job-queue PostgreSQL pool
     * @param loggerPort Records listener outage transitions
     */
    constructor(
        private readonly pool: Pool,
        private readonly loggerPort: ILoggerPort,
    ) {}

    /**
     * Holds a dedicated PostgreSQL session for queue wake-up notifications and reconnects after loss.
     *
     * @param channel PostgreSQL notification channel selected by pg-boss
     * @param onNotification Delivers queue-name wake-up hints
     * @param onReconnect Signals successful subscription so workers recover missed notifications
     * @returns Handle that stops reconnecting and releases the pinned session
     */
    async listen(
        channel: string,
        onNotification: (payload: string) => void,
        onReconnect: () => void,
    ): Promise<JobQueueNotificationSubscription> {
        return JobQueueNotificationSubscription.open({
            pool: this.pool,
            loggerPort: this.loggerPort,
            channel,
            onNotification,
            onReconnect,
        });
    }

    /**
     * Executes pg-boss SQL on the queue pool.
     *
     * @param text SQL statement
     * @param values Bound statement values
     * @returns PostgreSQL query result
     */
    executeSql(text: string, values?: unknown[]): Promise<QueryResult<QueryResultRow>> {
        return this.pool.query(text, values);
    }

    /**
     * Opens a worker transaction shared by pg-boss and Drizzle.
     *
     * @returns Transaction controls and the pg-boss database view
     */
    beginTransaction(): Promise<JobQueueTransaction> {
        return JobQueueTransaction.begin(this.pool);
    }

    /**
     * Runs consumer work with the worker transaction as the ambient database executor.
     *
     * @param jobQueueTransaction Transaction supplied to a transactional pg-boss handler
     * @param work Consumer work to run in that transaction
     * @returns The consumer result
     * @throws {SystemException} When the database was not created by this adapter
     */
    runInTransactionContext<T>(jobQueueTransaction: Db, work: () => Promise<T>): Promise<T> {
        if (!(jobQueueTransaction instanceof JobQueueTransaction)) {
            throw new SystemException('The job consumer received an unknown database transaction.', {
                context: { class: this.constructor.name, method: this.runInTransactionContext.name },
            });
        }

        return jobQueueTransaction.run(work);
    }

    /**
     * Closes the dedicated job-queue pool.
     */
    async close() {
        await this.pool.end();
    }
}
