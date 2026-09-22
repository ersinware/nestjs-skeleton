# Jobs & Messaging

- Durable asynchronous delivery uses `core/job-queue`, backed by pg-boss.
- Development/test startup may migrate the pg-boss schema. Production startup sets `migrate: false` and rejects a missing or mismatched schema.
- Before application rollout, a one-off migration job with dev dependencies runs `npm run deploy:migrate`: Drizzle migrations, pg-boss migrations, then pg-boss drift checks. Supply migration-scoped `DATABASE_URL` and `PGBOSS_DATABASE_URL` as secrets; `.secrets` mirrors only the latter for local `act`. Never use `db:push` against deployment databases or mutate them from pull-request CI.
- Keep pg-boss migration and runtime roles separate. The schema owner grants the runtime role schema usage, table DML, sequence usage, routine execution, and matching default privileges.
- Commands own the outer `ITransactionPort.run`. Aggregate writers persist state and accumulated jobs; commands enqueue command-owned jobs directly. All enqueueing uses the primary Drizzle proxy, so jobs commit with surrounding writes and audit. pg-boss owns its `pgboss` schema; exclude it from Drizzle discovery and schema filters.
- Delivery attempts may repeat; retries and backoff are bounded.
- Normal queues route terminal failures to the shared DLQ. Technical queues, including redrive orchestration, opt out with `disableDeadLetter: true`; the DLQ has no worker.
- Routing changes do not backfill already queued jobs or historical source failures.
- `job-queue-operations` provides protected, audited reads, atomic exact-ID discard, and exclusive, retryable redrive of DLQ copies. Jobs without a source queue remain in the DLQ; pg-boss retention bounds operation status.
- Job consumers declare `transactional: boolean`. Transactional consumers run only short PostgreSQL work: the ambient Drizzle executor and pg-boss completion share the pg-boss-owned transaction. Consumers that call Redis, email, or other network dependencies remain non-transactional and tolerate or deduplicate repeated effects.
- Worker batches contain one job. Set per-queue, per-process concurrency and polling through `IJobConsumer.workerOptions`; defaults live in `JobQueueFeatureModule`, overrides in consumers. Keep total transactional concurrency below the queue pool limit, reserving capacity for polling, completion, and maintenance. Concurrency scales with process count and is not a global rate limit; account for provider quotas.
- Stop DLQ sampling before pg-boss workers, and workers before database pools.
- `JobDefinition` carries `{ deliveryId, aggregateId, queueName }`; `deliveryId` identifies one logical delivery across retries. Consumers re-read current authoritative state; carry no business snapshots.
- Cross-context producers depend on owner-defined shared job contracts, never another module's domain enum. Keep queue names and payloads compatible with queued work and concurrently running versions.
- Runtime provisioning creates missing queues, verifies immutable policy/partitioning, and reconciles mutable retry defaults. Change immutable options through an explicit operational migration.
- Durable job consumers use `application/queue/`; network ingress uses `presentation/listener/`. Thin listeners and consumers await commands through pipelines; cache eviction may call its port directly.
- Prefer idempotent reconciliation for repeated/concurrent delivery. Email may be sent more than once.
- Pipeline and durable-job cache eviction share `<module>-cache-key.util.ts`; neither prevents concurrent stale cache fills. Failure semantics: [Adapters](data-and-state.md#adapters).
