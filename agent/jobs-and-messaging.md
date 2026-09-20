# Jobs & Messaging

- Durable asynchronous delivery uses `core/job-queue`, backed by pg-boss.
- Commands own the outer `ITransactionPort.run`. Aggregate writers persist state and accumulated jobs; commands enqueue command-owned jobs directly. All enqueueing uses the primary Drizzle proxy, so jobs commit with surrounding writes and audit. pg-boss owns its `pgboss` schema; exclude it from Drizzle discovery and schema filters.
- Delivery attempts may repeat; consumer failures retry the job. Retries/backoff are bounded; exhausted jobs remain failed, with no application-managed recovery or DLQ management.
- Job consumers declare `transactional: boolean`. Transactional consumers run only short PostgreSQL work: the ambient Drizzle executor and pg-boss completion share the pg-boss-owned transaction. Consumers that call Redis, email, or other network dependencies remain non-transactional and tolerate or deduplicate repeated effects.
- Stop pg-boss workers before their database pools.
- `JobDefinition` carries `{ deliveryId, aggregateId, queueName }`; `deliveryId` identifies one logical delivery across retries. Consumers re-read current authoritative state; carry no business snapshots.
- Cross-context producers depend on owner-defined shared job contracts, never another module's domain enum. Keep queue names and payloads compatible with queued work and concurrently running versions.
- Durable job consumers use `application/queue/`; network ingress uses `presentation/listener/`. Thin listeners and consumers await commands through pipelines; cache eviction may call its port directly.
- Prefer idempotent reconciliation for repeated/concurrent delivery. Email may be sent more than once.
- Pipeline and durable-job cache eviction share `<module>-cache-key.util.ts`; neither prevents concurrent stale cache fills. Failure semantics: [Adapters](data-and-state.md#adapters).
