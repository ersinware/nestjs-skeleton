# Jobs & Messaging

- Durable asynchronous delivery uses `core/job-queue`, backed by pg-boss.
- Development/test startup may migrate the pg-boss schema. Production startup sets `migrate: false` and rejects a missing or mismatched schema.
- Commands own the outer `ITransactionPort.run`. Aggregate writers persist state and accumulated jobs; commands enqueue command-owned jobs directly. All enqueueing uses the primary Drizzle proxy, so jobs commit with surrounding writes and audit. pg-boss owns its `pgboss` schema; exclude it from Drizzle discovery and schema filters.
- Delivery attempts may repeat; retries and backoff are bounded.
- Normal queues route terminal failures to the shared DLQ. Technical queues, including redrive orchestration, opt out with `disableDeadLetter: true`; the DLQ has no worker.
- Routing changes do not backfill already queued jobs or historical source failures.
- `job-queue-operations` provides protected, audited reads, atomic exact-ID discard, and exclusive, retryable redrive of DLQ copies. Jobs without a source queue remain in the DLQ; pg-boss retention bounds operation status.
- Job consumers declare `transactional: boolean`. Transactional consumers run only short PostgreSQL work: the ambient Drizzle executor and pg-boss completion share the pg-boss-owned transaction. Consumers that call Redis, email, or other network dependencies remain non-transactional and tolerate or deduplicate repeated effects.
- Worker batches contain one job. Set per-queue, per-process concurrency and polling through `IJobConsumer.workerOptions`; defaults live in `JobQueueFeatureModule`, overrides in consumers. Keep total transactional concurrency below the queue pool limit, reserving capacity for polling, completion, and maintenance. Concurrency scales with process count and is not a global rate limit; account for provider quotas.
- Stop DLQ sampling before pg-boss workers, and workers before database pools.
- `JobDefinition` carries `{ deliveryId, aggregateId, queueName }`; `deliveryId` identifies one logical delivery across retries. Consumers re-read current authoritative state; carry no business snapshots.
- Persist only optional W3C `traceparent` with job data, not baggage or vendor trace state. Retries, DLQ copies, and redrive retain it; domain jobs and older payloads need no trace field.
- Cross-context producers depend on owner-defined shared job contracts, never another module's domain enum. Keep queue names and payloads compatible with queued work and concurrently running versions.
- Runtime provisioning creates missing queues, verifies immutable policy/partitioning, and reconciles mutable retry defaults. Change immutable options through an explicit operational migration.
- Durable job consumers use `application/queue/`; network ingress uses `presentation/listener/`. Thin listeners and consumers await commands through pipelines; cache eviction may call its port directly.
- Prefer idempotent reconciliation for repeated/concurrent delivery. Email may be sent more than once.
- Pipeline and durable-job cache eviction share `<module>-cache-key.util.ts`; neither prevents concurrent stale cache fills. Failure semantics: [Adapters](data-and-state.md#adapters).

### Deployment

- Before rollout, run `npm run deploy:migrate` once in a migration job with dev dependencies. It runs Drizzle migration, pg-boss migration, then drift check. Do not use `db:push` against deployment databases or mutate them from pull-request CI.
- Drizzle reads `DATABASE_URL`; the pg-boss CLI reads `PGBOSS_DATABASE_URL`. Both must target the runtime's logical primary database. The CLI variable may alias the migration job's `DATABASE_URL`; a second stored secret is optional. Local `act` receives the CLI variable through `.secrets`.
- Use separate migration and runtime database roles. Keep migration credentials out of the application. Grant runtime schema usage, required table DML, sequence usage, and routine execution; configure future-object default privileges. Verify existing grants as the runtime role before rollout.
- At first rollout, assign the three DLQ permissions to intended operator admins. Verify source queues route to `application-dead-letter` and the redrive queue opts out. For rollback to code without DLQ routing, clear persisted source `dead_letter` settings before or with the old code; retain the DLQ and its jobs.
