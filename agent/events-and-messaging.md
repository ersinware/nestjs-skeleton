# Events & Messaging

- Events use in-process `IEventPublisherPort.emitAsync`; only `event-bus` uses `EventEmitter2`. No persistent delivery, automatic retry, or cross-instance transport is implemented.
- Aggregate writers call `publishDomainEvents` after SQL succeeds, without awaiting listeners. Dispatch may precede transaction commit; rollback does not undo listener effects. Writers and refresh-reuse dispatch suppress listener failures; logout-all awaits them.
- `DispatchedDomainEvent` carries `{ aggregateId, eventId }`; event names come from owner enums. Consumers re-read current authoritative state through owned ports/facades; carry no business snapshots.
- In-process subscriptions use `OnAppEvent` (`suppressErrors: false`) in `application/event/`; network ingress uses `presentation/listener/`. Thin listeners await commands through pipelines; cache eviction may call its port directly.
- Prefer idempotent reconciliation for repeated/concurrent events; `eventId` alone provides no deduplication. Email may be sent more than once.
- Pipeline and event cache eviction share `<module>-cache-key.util.ts`; neither prevents concurrent stale cache fills. Failure semantics: [Adapters](data-and-state.md#adapters).
