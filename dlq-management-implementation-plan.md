# DLQ Management Implementation Plan

## Purpose

Add observable and operator-controlled dead-letter handling to the existing pg-boss job system without creating a second source of truth. The shared DLQ and read-only operations exist, but source queues do not yet route failed jobs to it.

The implementation must preserve the existing at-least-once delivery model, transactional job production, bounded retries, module boundaries, authorization, audit durability, and horizontally scaled runtime.

## Progress

- [x] Phase 1 - Queue topology and core contracts
- [x] Phase 2 - Read-only operations module
- [ ] Phase 3 - Exact discard
- [ ] Phase 4 - Asynchronous all-job redrive
- [ ] Phase 5 - Metrics and alerting
- [ ] Phase 6 - Enable dead-letter routing
- [ ] Phase 7 - Verification
- [ ] Phase 8 - Documentation and rollout

Implement the control plane and its verification before Phase 6 activates failure routing.

## Agreed scope

- Use one shared DLQ named `application-dead-letter`.
- Manage it through a technical module named `job-queue-operations`; it is not a business bounded context.
- Route only jobs that exhaust retries after DLQ configuration is enabled.
- Do not scan or redrive retained `failed` rows in source queues. Existing failures receive no automatic backfill.
- Redrive all currently redrivable DLQ jobs to their recorded `sourceName`.
- Expose no redrive body, source filter, job ID, reason, or limit.
- Discard one or more exact DLQ job IDs; expose no reason field.
- Keep raw payloads, exception output, and personal data out of HTTP responses, audit, logs, traces, and metric attributes.
- Do not add the DLQ to readiness. An accumulated DLQ is an operational incident, not proof that the process cannot serve traffic.

## Simplest design that preserves the guarantees

| Concern            | Decision                                                                                                                             | Complexity avoided                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| DLQ storage        | Use pg-boss's `pgboss.job` rows and provenance fields.                                                                               | No application DLQ table or synchronization.                                            |
| Operation storage  | Use one pg-boss orchestration job as the redrive operation. Its ID is `operationId`; its state backs the status endpoint.            | No `job-queue-operations.schema.ts`, migration, repository, or operation state machine. |
| Concurrent redrive | Give the orchestration queue the pg-boss `exclusive` policy. A rejected enqueue becomes HTTP 409.                                    | No application lock or leader election.                                                 |
| Redrive progress   | Expose operation state, not an exact cumulative moved count.                                                                         | No checkpoint table needed to survive worker crashes.                                   |
| Redrive recovery   | Drain in fixed internal batches until pg-boss reports zero moved. A retried orchestration job continues with the remaining DLQ rows. | No custom retry or cursor mechanism.                                                    |
| Discard            | Call pg-boss `deleteJob` with exact IDs inside the application transaction and verify every requested row was affected.              | No custom delete protocol.                                                              |
| Detail lookup      | Use pg-boss `findJobs` with an ID filter.                                                                                            | No direct SQL for a supported lookup.                                                   |
| Paginated listing  | Isolate one read-only SQL method in the core dead-letter adapter over the pg-boss-owned job table; `findJobs` lacks pagination.      | Avoid loading the entire DLQ into memory and avoid owning a mirror table.               |
| Monitoring         | Poll pg-boss and cache a small in-memory snapshot for OpenTelemetry observable gauges.                                               | The Collector remains a telemetry forwarder and does not query PostgreSQL.              |
| Audit              | Audit the durable operator request, exact discard, and protected reads. Use pg-boss state for redrive lifecycle.                     | No unreliable duplicate lifecycle audit around worker completion.                       |

The only direct pg-boss-table dependency is the read-only paginated listing/oldest-age query. Keep it behind one adapter and pin it with an integration test. All mutations use pg-boss APIs.

## Public API

All routes are under `/v1/job-operations/dead-letter`.

| Method and path             | Permission                      | Result                                                                                                 |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /jobs`                 | `job-queue:dead-letter:read`    | Offset-paginated, newest-first sanitized summaries.                                                    |
| `GET /jobs/:id`             | `job-queue:dead-letter:read`    | One sanitized DLQ record or 404.                                                                       |
| `POST /redrive`             | `job-queue:dead-letter:redrive` | `202` with `{ operationId, status: "ACCEPTED" }`; `409` when an operation is already queued or active. |
| `GET /redrive/:operationId` | `job-queue:dead-letter:read`    | Current operation state or 404.                                                                        |
| `POST /discard`             | `job-queue:dead-letter:discard` | Body `{ jobIds: string[] }`; bodyless `204`.                                                           |

Use distinct `/jobs/:id` and `/redrive/:operationId` routes so static operation paths cannot collide with a generic ID route.

The job views may expose only:

- DLQ job ID;
- source queue and source job ID;
- original creation time and DLQ creation time;
- source retry count;
- `deliveryId` and `aggregateId`.

Do not expose pg-boss `data`, `output`, stack traces, or arbitrary error text. DLQ reads fail with a masked system error when source provenance or payload identifiers are missing or invalid; never return a partially populated job view.

Map orchestration states as follows:

- `created` or `retry` -> `ACCEPTED`;
- `active` -> `RUNNING`;
- `completed` -> `COMPLETED`;
- `failed` -> `FAILED`;
- `cancelled` -> `CANCELLED`.

Operation status exists only for pg-boss's configured retention window. Audit is the long-lived evidence; no permanent operation history is promised.

## Phase 1 - Queue topology and core contracts

### Work

1. Add centrally owned constants for `application-dead-letter` and the redrive orchestration queue.
2. Provision and verify the shared DLQ before any source queue may reference it. Do not start a worker for the DLQ.
3. Extend consumer queue metadata only as much as required:
    - normal application queues remain `standard`; Phase 6 will opt them into the shared DLQ;
    - the redrive orchestration queue overrides policy to `exclusive` and disables dead-letter routing;
    - immutable policy/partition mismatches still fail startup;
    - mutable retry and `deadLetter` options are reconciled explicitly.
4. Add narrow core ports for dead-letter reads, operator mutations, and metrics instead of exporting the raw pg-boss client/token. One adapter implements all three and is shared through `useExisting`; pg-boss types do not leak into the module application layer.
5. Keep existing aggregate/command job writers unchanged. Redrive orchestration enqueueing may use a dedicated method because it must return an ID or an exclusive-policy rejection, unlike ordinary fire-and-forget job persistence.

### Acceptance criteria

- DLQ creation always precedes source queue reconciliation.
- The orchestration queue can never dead-letter into `application-dead-letter`.
- Normal queue behavior remains unchanged until source `deadLetter` routing is enabled in Phase 6.
- No application-owned schema or migration is introduced.

## Phase 2 - Read-only operations module

### Work

1. Create `src/module/job-queue-operations/` without a domain aggregate or database schema.
2. Add the three permissions and assign them to the ADMIN principal kind:
    - `JOB_DEAD_LETTER_READ = job-queue:dead-letter:read`;
    - `JOB_DEAD_LETTER_REDRIVE = job-queue:dead-letter:redrive`;
    - `JOB_DEAD_LETTER_DISCARD = job-queue:dead-letter:discard`.
3. Implement list and detail queries through purpose-specific application ports.
4. Implement offset pagination using the shared pagination contract. The core dead-letter adapter performs a bounded page query plus count against the pg-boss-owned job table, ordered by `created_on DESC, id DESC` and restricted to `application-dead-letter`; the module infrastructure adapter forwards purpose-specific query ports to it.
5. Use `findJobs(application-dead-letter, { id })` for detail and return 404 for any missing/non-DLQ ID.
6. Add response DTOs, validation, cache policies, Swagger tag/version description, authentication, permission checks, and `JOB_DEAD_LETTER_ACCESSED` disclosure audit.
7. Add `JobQueueOperationsModule` to the application composition root.

### Acceptance criteria

- List queries do not load the full DLQ.
- Responses contain only the approved metadata.
- Invalid persisted provenance or payload identifiers fail the affected read without exposing raw job data.
- The module imports no raw pg-boss client and owns no table.

## Phase 3 - Exact discard

### Work

1. Add `DiscardDeadLetterJobsCommand` with a non-empty, unique UUID list.
2. Inside one `ITransactionPort.run` callback:
    - call the core adapter's exact-ID deletion against `application-dead-letter` using the ambient Drizzle transaction;
    - verify the pg-boss result affected every requested ID;
    - on any missing/racing ID, throw and roll back the entire delete;
    - record one `JOB_DEAD_LETTER_DISCARDED` audit entry containing IDs and count, never payloads.
3. Return bodyless `204` only after commit.

### Acceptance criteria

- Discard cannot delete a same-ID job from another queue.
- A mixed valid/missing request deletes nothing.
- Concurrent redrive/discard yields one winner; the loser receives 404 without partial success.
- Audit and deletion commit or roll back together.

## Phase 4 - Asynchronous all-job redrive

### Work

1. Add a no-body `StartDeadLetterRedriveCommand`.
2. In one transaction, enqueue the orchestration job and record `JOB_DEAD_LETTER_REDRIVE_REQUESTED` with its `operationId`.
3. Generate the operation ID before enqueue so the same ID is used by pg-boss, audit, and the response. If pg-boss rejects it because the `exclusive` queue already has a queued/active job, return 409 and roll back the audit.
4. Add a non-transactional redrive consumer. It repeatedly calls:
    - `redrive(application-dead-letter, { limit: INTERNAL_BATCH_SIZE })`;
    - stop only when the call returns zero.
5. Do not supply `destination` or `sourceName`; pg-boss routes each copy to its recorded `sourceName`.
6. Let consumer failures propagate so pg-boss retries the orchestration job. Already moved batches are absent from the DLQ, so the next attempt continues with remaining rows.
7. Add the status query using `findJobs(redrive-operation-queue, { id: operationId })` and the public state mapping above.

### Acceptance criteria

- The public endpoint has no request body or tuning parameters.
- Two concurrent start requests produce one `202` and one `409` across application replicas.
- Mixed-source jobs return to their own queues.
- Missing source queues remain orphaned in the DLQ and are not deleted.
- A crash between batches loses no DLQ job and a retry continues draining.
- No exact moved-total is reported; therefore crash recovery cannot produce misleading progress.
- A terminally failed orchestration job remains queryable as `FAILED` and is not sent into the application DLQ. A later POST may start a fresh operation.

## Phase 5 - Metrics and alerting

### Work

1. Add one lifecycle-managed sampler that runs immediately and then about once per minute.
2. Read queue counts through `getQueueStats(application-dead-letter, { force: true })` and obtain the oldest DLQ creation time through the same isolated read adapter used for listing.
3. Cache the sample in memory. OpenTelemetry observable callbacks must only read this snapshot; they must not query PostgreSQL during collection.
4. Export at least:
    - `job_queue_dlq_ready_count`;
    - `job_queue_dlq_oldest_age_seconds`;
    - `job_queue_dlq_monitor_up`;
    - `job_queue_redrive_failed_count` for exhausted orchestration jobs.
5. Do not attach job IDs, source queues, aggregate IDs, instance IDs, or payload fields as metric dimensions.
6. Configure Grafana alerts for a sustained non-empty DLQ, excessive oldest age, monitoring failure, and failed redrive operations. Aggregate replica gauges with `max`, not `sum`.
7. Report sampler failures through existing observability boundaries, retain the last successful business values, and set `monitor_up` to zero.

### Acceptance criteria

- The OTel Collector only forwards metrics emitted by the app; it never receives database credentials or polls pg-boss.
- A DLQ incident alerts without failing liveness/readiness.
- Multiple replicas do not multiply queue depth in dashboards or alerts.

## Phase 6 - Enable dead-letter routing

### Work

1. Set every normal application queue's mutable `deadLetter` option to `application-dead-letter` during startup reconciliation.
2. Keep source queues `standard`; this preserves safe redrive behavior for the current pg-boss implementation.
3. Verify rollout ordering: pg-boss schema migration/drift check, application startup and DLQ provisioning, then source queue reconciliation and workers.
4. Confirm the runtime database role already has the pg-boss privileges required by queue creation, reads, redrive, and deletion.
5. Do not touch old source-queue `failed` rows. Only new terminal failures create DLQ copies.

### Acceptance criteria

- Exhausting a source job leaves its original failed record under normal pg-boss retention and creates a separate DLQ copy with provenance.
- The DLQ copy is the only record managed by list, discard, and redrive endpoints.
- Rollback disables source `deadLetter` options explicitly before or with the older application rollout; it does not delete queues or retained jobs.

## Phase 7 - Verification

### Integration tests with real PostgreSQL and pg-boss

- Retry exhaustion creates one DLQ copy with `sourceName`, `sourceId`, original creation time, and retry count.
- The DLQ has no worker and retains queued copies.
- List pagination, ordering, total, detail lookup, and sanitization are correct.
- Review the pg-boss DLQ listing query plan at representative queue depth; the pg-boss indexes do not necessarily support its full sort order.
- Malformed/legacy data does not leak or crash response mapping.
- Exact single and bulk discard work; mixed valid/missing IDs roll back fully with audit.
- Mixed-source redrive drains more than one internal batch and routes every job to its source queue.
- A missing source queue remains in the DLQ.
- A forced failure between batches is retried and drains only the remainder.
- Concurrent redrive starts yield one accepted operation and one conflict.
- Operation states map correctly, including failed and cancelled records.
- DLQ and operation metrics reflect database state and sampler failure.

### HTTP E2E tests

- Unauthenticated requests return 401; principals without each permission return 403.
- List/detail/status schemas contain no raw payload or output.
- Redrive returns 202, concurrent redrive returns 409, and status uses the returned operation ID.
- Discard validates an exact non-empty unique ID array and returns bodyless 204.
- New routes appear under the configured OpenAPI tag with documented 400/401/403/404/409/500/503 responses as applicable.

### Regression checks

- Existing transactional-consumer guarantees still hold.
- Existing application queues retain their retry/backoff and worker concurrency settings.
- Type check, lint, unit tests, targeted integration/E2E tests, OpenAPI generation, Spectral, and build pass when implementation is complete.

## Phase 8 - Documentation and rollout

1. Update `agent/jobs-and-messaging.md` after implementation to replace the interim read-only/routing-disabled statement with the actual routing, redrive, discard, orphan, retry, and retention rules.
2. Update `agent/observability.md` with the sampler, metric cardinality, replica aggregation, and alert rules.
3. Update `agent/security-and-sessions.md` only if the new permissions require an enduring administration rule not already owned by the authorization guide.
4. Reassess `AGENTS.md`; add no duplicate implementation detail unless future work needs a new top-level routing rule.
5. Grant the new permissions to the intended operator admins through the normal permission-assignment process.
6. Create Grafana alerts before or with DLQ routing activation.
7. Deploy using the existing order: `npm run deploy:migrate`, then application rollout. This feature adds no application schema migration; the migration step still verifies pg-boss compatibility and drift.

## Deliberately deferred

Add none of the following unless a concrete requirement appears:

- an application-owned operation or DLQ table;
- historical failed-job backfill;
- per-source or per-job redrive;
- public redrive batch/limit parameters;
- exact cross-retry moved counts or percentage progress;
- permanent operation-status history beyond pg-boss retention;
- payload editing before redrive;
- DLQ-driven readiness failure;
- inbox/deduplication solely for DLQ management.

If exact progress across crashes or permanent operation history becomes mandatory, introduce an application-owned operation record then; do not prepay that complexity now.
