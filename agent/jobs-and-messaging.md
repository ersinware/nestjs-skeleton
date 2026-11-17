# Jobs & Messaging

## Delivery Guarantees

- Durable asynchronous work uses pg-boss and provides at-least-once delivery with bounded retries. Never assume eventual success, exactly-once execution, or exactly-once external effects.
- pg-boss prevents two workers from owning the same active attempt. However, expiration or heartbeat loss can make an attempt stale and start a retry while the original handler is still running in its process. The stale handler no longer owns the claim, but external effects it already performed cannot be rolled back. Consumers must therefore tolerate replay and, where external effects are involved, possible overlapping attempts.
- Exhausted application failures are retained in the shared DLQ unless a technical queue intentionally opts out. Failed work must remain recoverable or explicitly discarded; never silently drop it.

## Producing Jobs

- When application state, mutation audit, and follow-up jobs form one logical mutation, persist them in the same PostgreSQL transaction.
- Aggregate-owned jobs are raised by aggregates and persisted with aggregate state. Command-owned orchestration jobs may enqueue directly when the command owns that workflow.
- Cross-context producers depend only on contracts owned and exposed by the target context. Do not couple producers to another context's internal domain types.

## Consumer Transactions

- Use transactional consumers only for short PostgreSQL-only work when application writes and job completion must commit atomically. Transactional consumer paths must not perform external business effects.
- Transactional consumers cannot currently short-circuit `TerminalJobException` to terminal settlement safely. pg-boss does not expose a supported rollback-safe terminal settlement path for transactional workers; in particular, `transactional` workers cannot use `perJobResults`, which is the supported terminal/dead-letter result mechanism. This limitation is tracked in [issue #27](https://github.com/ersinware/nestjs-skeleton/issues/27). Propagate the failure so application writes roll back, then let pg-boss apply its normal retry/DLQ policy.
- Consumers that perform external business effects must be non-transactional. Commit required database state first, then perform the effect, and make retries resume from durable authoritative state.
- External effects must be idempotent, deduplicated, or explicitly safe to repeat. Re-read authoritative state before acting when eligibility may have changed.
- Use `TerminalJobException` only for failures that another attempt cannot recover from. Non-transactional consumers may bypass remaining retries for it; transactional consumers follow the limitation above.

## Concurrency & Execution

- Treat worker concurrency as local to a process unless the queue policy explicitly provides a distributed guarantee. Budget total concurrency across all queues, replicas, and deployment overlap.
- Do not use worker concurrency as a provider rate limiter. Hard downstream limits require an appropriate distributed coordination or provider-aware mechanism.
- Batching is not concurrency. Avoid implicit or unbounded parallelism inside a fetched batch.
- A transactional consumer processes one job per transaction.

## Dead-letter Recovery

- DLQ redrive is recovery of the same logical work, not creation of new logical work. Preserve its logical delivery identity even when pg-boss creates new physical queue records.
- Redrive and discard are explicit operator actions. Redrive must leave work recoverable when it cannot be restored safely; discard is the intentional terminal removal path.
- Redrive and discard mutations require durable audit evidence.

## Delivery Identity & Payloads

- `deliveryId` identifies logical work across retries, DLQ transitions, and redrive. pg-boss job IDs identify physical queue records and may change across those transitions.
- Reusing a `deliveryId` does not itself deduplicate queue inserts. New logical work requires a new delivery identity.
- Use logical delivery identity for reconciliation, follow-up correlation, audit correlation, and external idempotency.
- Persist only immutable delivery facts that cannot be recovered from authoritative state. Do not place aggregate snapshots or secrets in job payloads; consumers must validate persisted facts before use.

## Email Delivery

- Queued email is an external effect and follows the non-transactional consumer rules above.
- Derive provider idempotency from the stable logical delivery identity and keep the complete provider request stable across retries and redrive. Do not create a new identity merely to hide payload drift.
- Provider idempotency is retention-bounded and is not a permanent send ledger. Delayed retries or redrive may therefore send again; never claim exactly-once email sending or recipient receipt.
- Treat provider payload/idempotency conflicts as terminal. Treat recognized transient availability, locking, concurrency, and rate-limit failures as retryable.

## Deployment

- Production application startup must not migrate the pg-boss schema. Apply job-queue schema changes explicitly before rollout.
- pg-boss owns its schema; application migration tooling must not manage pg-boss-owned objects.
- Application and pg-boss migrations must target the same logical primary database.
- Keep migration privileges separate from runtime application privileges.
