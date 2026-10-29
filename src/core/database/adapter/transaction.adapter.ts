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
import { SystemException } from 'src/shared/exception';

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
     * Opens and commits a transaction only when no ambient transaction exists.
     *
     * @param work Awaited database work
     * @returns Callback result after commit completes
     */
    async start<T>(work: () => Promise<T>): Promise<T> {
        if (transactionStorage.getStore()) {
            throw new SystemException('Cannot start a transaction while another transaction is active.', {
                context: { class: TransactionAdapter.name, method: this.start.name },
            });
        }

        try {
            return await this.database.transaction((tx) => transactionStorage.run(tx, work));
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Executes work in the ambient transaction without committing it.
     * Resolution does not guarantee commit; do not follow it with external side effects.
     *
     * @param work Awaited database work
     * @returns Callback result before the transaction owner commits
     */
    async join<T>(work: () => Promise<T>): Promise<T> {
        if (!transactionStorage.getStore()) {
            throw new SystemException('Cannot join a transaction when no transaction is active.', {
                context: { class: TransactionAdapter.name, method: this.join.name },
            });
        }

        try {
            return await work();
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }
}
