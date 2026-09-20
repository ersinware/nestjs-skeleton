# Events & Messaging

- Migrate delivery incrementally: Admin uses `core/job-queue`; User and Auth temporarily retain `core/outbox` and the in-process event bus. Migrate User, then Auth; add no new legacy delivery and remove both legacy concerns afterwards.
- Commands own `ITransactionPort.run`; aggregate writers persist state and jobs in that transaction, without opening another. Enqueue through the primary Drizzle proxy. pg-boss owns its `pgboss` schema; exclude it from Drizzle discovery and schema filters.
- Delivery attempts may repeat; consumer failures retry the job. Retries/backoff are bounded; exhausted jobs remain failed, with no application-managed recovery or DLQ management.
- Job consumers declare `transactional: boolean`. Transactional consumers run only short PostgreSQL work: the ambient Drizzle executor and pg-boss completion share the pg-boss-owned transaction. Consumers that call Redis, email, or other network dependencies remain non-transactional and tolerate or deduplicate repeated effects.
- Stop pg-boss workers before their database pools. During migration, stop legacy outbox workers before in-process listeners.
- Legacy `DispatchedDomainEvent` carries `{ aggregateId }`; consumers re-read current authoritative state through owned ports/facades. Do not extend this contract.
- Aggregate-owned `JobDefinition` carries `{ eventId, aggregateId, queueName }`; queue names come from owner enums. Consumers re-read current authoritative state; carry no business snapshots.
- Cross-context producers depend on shared job contracts, never another module's domain enum. Keep queue names and payloads compatible with queued work and concurrently running versions.
- Durable job consumers use `application/queue/`; network ingress uses `presentation/listener/`. During migration, legacy in-process subscriptions remain in `application/event/` through `OnAppEvent` (`suppressErrors: false`). Thin listeners and consumers await commands through pipelines; cache eviction may call its port directly.
- Prefer idempotent reconciliation for repeated/concurrent delivery. Email may be sent more than once.
- Pipeline and event cache eviction share `<module>-cache-key.util.ts`; neither prevents concurrent stale cache fills. Failure semantics: [Adapters](data-and-state.md#adapters).
