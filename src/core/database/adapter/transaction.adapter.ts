/**
 * @file transaction.adapter.ts
 * @description Runs database work with an async-local Drizzle transaction.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database/database-client.token';
import { transactionStorage } from 'src/core/database/database-transaction.storage';
import { translateConnectionFailure } from 'src/core/database/driver-error.util';
import type { ITransactionPort } from 'src/core/database/port/transaction.port';

/**
 * Shares the transaction with adapters through AsyncLocalStorage.
 */
@Injectable()
export class TransactionAdapter implements ITransactionPort {
    /**
     * Initializes the adapter with the primary database proxy used to open the outermost
     * transaction.
     *
     * @param database Primary database proxy
     */
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly database: NodePgDatabase) {}

    /**
     * Joins an existing transaction or opens one for the callback.
     *
     * @param work Awaited database work
     * @returns Callback result; the outer call waits for commit
     */
    async run<T>(work: () => Promise<T>): Promise<T> {
        try {
            if (transactionStorage.getStore()) {
                return await work();
            }

            return await this.database.transaction((tx) => transactionStorage.run(tx, work));
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }
}
