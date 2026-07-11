import type { AggregateRoot } from 'src/shared/domain/aggregate-root';

export const TOKEN_TRANSACTIONAL_OUTBOX_PORT = Symbol('TOKEN_TRANSACTIONAL_OUTBOX_PORT');

export interface ITransactionalOutboxPort {
    run<T>(work: () => Promise<T>, aggregateRoot: AggregateRoot): Promise<T>;
}
