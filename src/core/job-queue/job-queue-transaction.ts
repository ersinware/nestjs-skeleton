/**
 * @file job-queue-transaction.ts
 * @description Shares a pg-boss worker transaction with Drizzle-backed application work.
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import type { Db } from 'pg-boss';
import { runInDatabaseTransactionContext } from 'src/core/database';
import { toError } from 'src/shared/exception';

/**
 * Maximum wait before a stuck rollback causes the connection to be discarded.
 */
const ROLLBACK_TIMEOUT_MILLISECONDS = 5000;

/**
 * Exposes one PostgreSQL transaction to both pg-boss and Drizzle.
 */
export class JobQueueTransaction implements Db {
    /**
     * pg-boss database view bound to this transaction.
     */
    readonly db: Db = this;

    /**
     * Drizzle executor bound to the transaction connection.
     */
    private readonly drizzle: NodePgDatabase;

    /**
     * Whether the transaction connection has been released.
     */
    private released = false;

    /**
     * Connection failure retained for later operations.
     */
    private connectionError: Error | null = null;

    /**
     * Discards the client after a connection failure.
     *
     * @param error Connection failure
     */
    private readonly onConnectionError = (error: Error) => {
        this.connectionError ??= error;
        this.release(error);
    };

    /**
     * Initializes the transaction on a dedicated connection.
     *
     * @param poolClient Connection dedicated to this transaction
     */
    private constructor(private readonly poolClient: PoolClient) {
        this.drizzle = drizzle({ client: poolClient });
        this.poolClient.on('error', this.onConnectionError);
    }

    /**
     * Checks out a connection and begins a transaction.
     *
     * @param pool Dedicated job-queue pool
     * @returns Open transaction
     */
    static async begin(pool: Pool): Promise<JobQueueTransaction> {
        const instance = new JobQueueTransaction(await pool.connect());

        try {
            await instance.poolClient.query('BEGIN');

            return instance;
        } catch (error) {
            instance.release(toError(error));

            throw error;
        }
    }

    /**
     * Executes pg-boss SQL on the transaction connection.
     *
     * @param text SQL statement
     * @param values Bound statement values
     * @returns PostgreSQL query result
     */
    executeSql(text: string, values?: unknown[]): Promise<QueryResult<QueryResultRow>> {
        if (this.released) {
            return Promise.reject(this.settledError());
        }

        return this.poolClient.query(text, values);
    }

    /**
     * Exposes this transaction as the ambient Drizzle executor during application work.
     *
     * @param work Consumer work
     * @returns Consumer result
     */
    run<T>(work: () => Promise<T>): Promise<T> {
        return runInDatabaseTransactionContext(this.drizzle, work);
    }

    /**
     * Commits the transaction and releases its connection.
     */
    async commit() {
        if (this.released) {
            throw this.settledError();
        }

        try {
            await this.poolClient.query('COMMIT');
        } catch (error) {
            this.release(toError(error));

            throw error;
        }

        this.release();
    }

    /**
     * Rolls back and releases the transaction connection.
     */
    async rollback() {
        if (this.released) {
            return;
        }

        let timeout: NodeJS.Timeout | undefined;

        try {
            await Promise.race([
                this.poolClient.query('ROLLBACK'),
                new Promise<never>((_resolve, reject) => {
                    timeout = setTimeout(
                        () => reject(new Error('The job queue transaction rollback timed out.')),
                        ROLLBACK_TIMEOUT_MILLISECONDS,
                    );
                }),
            ]);

            this.release();
        } catch (error) {
            this.release(toError(error));
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }

    /**
     * Releases the client once and optionally discards it.
     *
     * @param error Failure requiring the pool to discard the connection
     */
    private release(error?: Error) {
        if (this.released) {
            return;
        }

        this.released = true;
        this.poolClient.removeListener('error', this.onConnectionError);
        this.poolClient.release(error);
    }

    /**
     * Returns the error explaining why the transaction is unavailable.
     *
     * @returns Transaction state error
     */
    private settledError(): Error {
        return this.connectionError ?? new Error('The job queue transaction is already settled.');
    }
}
