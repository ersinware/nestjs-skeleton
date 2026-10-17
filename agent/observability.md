# Observability

- Send OTel traces/metrics through the Collector to Grafana Cloud and JSON stdout to Loki; Sentry tracks exceptions ([Audit](observability.md#audit)).
- Keep routing/credentials in deployment configuration. Local Collector settings use ignored `.env.observability`, excluded from API containers/images. Compose telemetry needs the `observability` profile; app traces/metrics also need SDK enablement. `OTEL_SDK_DISABLED` does not disable stdout logs. No local telemetry stores; AWS routing/storage, including planned FireLens, remain unimplemented.
- Initialize `reflect-metadata` → `instrument.ts` → `tracing.ts` before application imports. OTel owns tracing; preserve Sentry `skipOpenTelemetrySetup: true` and `SentryContextManager`.
- Preserve Fastify route spans/`http.route`, stable HTTP metrics (`OTEL_SEMCONV_STABILITY_OPT_IN=http`), pg instrumentation with `requireParentSpan` (suppressing all parentless PostgreSQL spans, not only idle polling), and active Pino `traceId`/`spanId` correlation. Disable Fastify hook spans and fs/net/dns instrumentation; match Grafana correlations to emitted fields.
- Handlers call reporting ports only at detached best-effort session catches: ignore dependency-unavailable failures, report all others without rethrowing. Report once at the owning boundary ([Exceptions](exceptions.md#exceptions), [CQRS](architecture.md#cqrs), [Dependency Outages](observability.md#dependency-outages)): unexpected/actionable failures → `IErrorReporterPort` (error + Sentry); recovery breadcrumbs → warn with alert coverage; significant operational transitions → info. Callers select failures; the reporter only pairs destinations.
- Preserve HTTP log allowlists; exclude bodies, query strings, and sensitive headers. Keep secrets and unnecessary personal data out of logs, spans, and exception payloads.
- Pass errors directly to the logger; do not copy exception context into log `data`.
- Queue boundaries report delivery identities once; job-only exception contexts omit them. Never report whole job payloads.
- Preserve SDK `parentbased_always_on`; never configure sampler overrides that drop traces before the Collector. Collector tail sampling retains traces with any ERROR span or latency above the configured threshold and samples the remainder by configured percentage; logs/metrics are unsampled. Upstream drops, including unsampled parents, cannot be recovered; downstream sampling must honor the retention policy.
- Route each trace to one tail-sampling Collector; size decision windows/capacity for traffic and late spans. Pending traces/decisions are memory-only: restarts, overload, and late arrivals can lose error evidence or traces.
- Match service/environment attributes across signals and Compose log labels. Generate a fresh `service.instance.id` per SDK startup, preserving env/host/process attributes and overriding static IDs. Exclude trace/user/request IDs from metric dimensions and Loki index labels; exclude instance/task IDs from Loki index labels.
- Each delivery attempt starts a new root consumer span, not an HTTP child. It links back to its producer when valid `traceparent` exists; missing or malformed context does not block delivery. Link visibility depends on sampling and retention.
- Collect local Docker logs only with `telemetry.logs: 'true'`; exclude Collector diagnostics.
- Preserve `file_storage` exporter queues and log offsets on the local named volume. Offsets alone do not guarantee delivery; buffers, retry limits, and storage loss can lose telemetry.

### Audit

- Module-specific refusal actions stay with the deciding aggregate or handler; shared refusal actions stay in `DomainFailureAuditAction`. Audit contracts carry strings without importing module vocabularies. Reuse an action for the same event; distinct events require distinct values. Core `AuditAction` owns other actions.
- `IAuditPort` records evidence, not diagnostics: append-only primary `audit.audit` ([Data & State](data-and-state.md#data--state)), independent of log level/sampling and active in tests. Durability requires outer commit in a transaction, insert completion otherwise. Audit loss is unacceptable.
- Refusal records using `markExceptionAsAudited` must survive mutation rollback: commit independently, then mark the exact exception in the current request. Never persist exception tracking or mark before commit; ordinary records retain transaction participation.
- Fact owners persist mutation audit with the mutation and delivery records in one DB transaction; failure rolls them back together. Capture facts, time, trace, and verified context at mutation time. Never defer a producer fact to a consumer or reconstruct history from current state.
- Queued session revocation needs distinct request and completion records linked by `deliveryId`: Auth audits enqueue; the owner audits the counter change with its follow-up jobs. Completion records identify the target and resulting version on each committed retry; they do not inherit the requesting actor.
- Use `@Audited` / `AuditInterceptor` only for reads/disclosures: await durable audit acceptance before emitting results; audit failure fails the response, handler failure creates no disclosure record. Filter 403 ownership: [Exceptions](exceptions.md#exceptions); its audit failures follow error reporting without replacing the original response.
- `auditContextHook` (`main.ts`, `onRequest`) seeds transport before guards; authentication adds verified, session-checked identity before authorization. Never publish unverified payloads; interceptors are too late.
- Audit actors travel via AsyncLocalStorage, never command payloads; absent non-HTTP actors leave unattributed records. Business actors remain explicit ([Authentication & Authorization](security-and-sessions.md#authentication--authorization)).
- Callers supply only non-ambient facts. Audit actions include outcome; `actorType` identifies the actor's owning context. Use `targetId` for a distinct subject or actorless action; omit it for self-service on the actor's own account. Administrative refusals and explicit-ID disclosures retain `targetId` even when it equals `actorId`.
- Apply retention and data minimization: no tokens, passwords, or full PII payloads; restrict `AuditDetail` values to identifiers, enums, and relevant version counters. At the hook, prefer matched route templates, strip queries from unmatched paths, and cap user-agent length.

### Dependency Outages

- Per application instance and client/pool, log observed outage transitions once: `warn` + driver error + `ConnectionLogMessage.LOST`, then `info` + `RESTORED`. Identify the connection; vocabulary belongs in `core/observability/logger`.
- Redis client events own transition logs; PostgreSQL health probes own database-pool transition logs. Keep pool error listeners without duplicate reporting; share the probe when replica aliases primary.
- Database health probes do not cover independent pg-boss pools or delivery progress.
- Suppress duplicate outage logs/Sentry, preserving failure semantics ([Adapters](data-and-state.md#adapters), [Session Versions & Failure Semantics](security-and-sessions.md#session-versions--failure-semantics), [Exceptions](exceptions.md#exceptions), [Jobs & Messaging](jobs-and-messaging.md#jobs--messaging)).
- Require regular external health checks and Grafana Cloud alerts, including separate cache monitoring ([Health Probes](http.md#health-probes)); transition logs are diagnostic.

### Dead-letter Monitoring

- Enable `JOB_QUEUE_DLQ_MONITOR_ENABLED` only on the designated monitoring instance; deployment owns replacement, with no leader election. Disabled monitors allocate no instruments/callbacks, perform no reads, and emit no DLQ series; job workers remain enabled. The monitoring instance needs the OTel SDK and Collector.
- Sample immediately, then wait `JOB_QUEUE_DLQ_SAMPLE_INTERVAL` after each attempt. pg-boss may reuse forced queue statistics for up to one minute.
- OTel callbacks read only the last complete sample; export has its own interval. Before the first success, emit no business metrics. On failure, retain previous values and emit `job_queue_dlq_monitor_up=0`. DLQ state does not affect readiness.
- Report sampling failure once until recovery: dependency unavailability → `warn`, other failures → `IErrorReporterPort`, recovery → `info`. Reporting failures must not interrupt sampling.
- Alert on non-empty/aging DLQ, failed redrive, and monitor failure. Aggregate shared counts/age with `max`, never `sum`, and monitor health with `min`. Apply thresholds in Grafana; do not filter healthy series out of PromQL results. Set monitor No Data/query errors to Alerting; a silent instance is hidden while another still reports. Keep job/source/payload identifiers out of metric dimensions.
