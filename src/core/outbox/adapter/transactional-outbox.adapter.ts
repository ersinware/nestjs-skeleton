import { Inject, Injectable } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { transactionStorage } from 'src/core/database';
import { TOKEN_DATABASE } from 'src/core/database/constant/constant';
import { TOKEN_OUTBOX_LEDGER_PORT, type IOutboxLedgerPort, type ITransactionalOutboxPort } from 'src/core/outbox/port';
import type { AggregateRoot } from 'src/shared/domain/aggregate-root';

@Injectable()
export class TransactionalOutboxAdapter implements ITransactionalOutboxPort {
    constructor(
        @Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase,
        @Inject(TOKEN_OUTBOX_LEDGER_PORT) private readonly outboxLedgerPort: IOutboxLedgerPort,
    ) {}

    run<T>(work: () => Promise<T>, aggregateRoot: AggregateRoot): Promise<T> {
        return this.db.transaction((tx: PostgresJsDatabase) => {
            return transactionStorage.run(tx, async () => {
                const result = await work();

                if (aggregateRoot.domainEvents.length > 0) {
                    await this.outboxLedgerPort.saveEvents(aggregateRoot.domainEvents);
                    aggregateRoot.clearDomainEvents();
                }

                return result;
            });
        });
    }
}
