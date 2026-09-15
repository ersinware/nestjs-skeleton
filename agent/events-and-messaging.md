# Events & Messaging

- Commands own `ITransactionPort.run`; aggregate writers persist state and pg-boss jobs through `core/outbox` in that transaction, without opening another. Enqueue through the primary Drizzle proxy. pg-boss owns its `pgboss` schema; exclude it from Drizzle discovery and schema filters.
- Only outbox workers publish to the in-process bus, awaiting listener readiness and `IEventPublisherPort.publish`; only `event-bus` uses `EventEmitter2`. Instances compete for jobs; no cross-instance event broadcast is implemented.
- Delivery attempts may repeat; failures retry the whole event, including successful listeners, with bounded retries/backoff. Exhausted retries leave failed jobs; no application-managed recovery or DLQ management is implemented.
- Stop outbox workers before listeners and database pools shut down.
- `DispatchedDomainEvent` carries `{ aggregateId }`; event names come from owner enums. Consumers re-read current authoritative state through owned ports/facades; carry no business snapshots.
- Keep event names and payloads compatible with queued jobs and concurrently running versions.
- In-process subscriptions use `OnAppEvent` (`suppressErrors: false`) in `application/event/`; network ingress uses `presentation/listener/`. Thin listeners await commands through pipelines; cache eviction may call its port directly.
- Prefer idempotent reconciliation for repeated/concurrent events. Email may be sent more than once.
- Pipeline and event cache eviction share `<module>-cache-key.util.ts`; neither prevents concurrent stale cache fills. Failure semantics: [Adapters](data-and-state.md#adapters).
