# Observability

- Send OTel traces/metrics through the Collector to Grafana Cloud and JSON stdout to Loki; Sentry tracks exceptions ([Audit](observability.md#audit)).
- Keep routing/credentials in deployment configuration. Local Collector settings use ignored `.env.observability`, excluded from API containers/images. Compose telemetry needs the `observability` profile; app traces/metrics also need SDK enablement. `OTEL_SDK_DISABLED` does not disable stdout logs. No local telemetry stores; AWS routing/storage, including planned FireLens, remain unimplemented.
- Initialize `reflect-metadata` → `instrument.ts` → `tracing.ts` before application imports. OTel owns tracing; preserve Sentry `skipOpenTelemetrySetup: true` and `SentryContextManager`.
- Preserve Fastify route spans/`http.route`, stable HTTP metrics (`OTEL_SEMCONV_STABILITY_OPT_IN=http`), pg instrumentation, and active Pino `traceId`/`spanId` correlation. Disable Fastify hook spans and fs/net/dns instrumentation; match Grafana correlations to emitted fields.
- Handlers call reporting ports only at detached best-effort session catches: ignore dependency-unavailable failures, report all others without rethrowing. Report once at the owning boundary ([Exceptions](exceptions.md#exceptions), [CQRS](architecture.md#cqrs), [Dependency Outages](observability.md#dependency-outages)): unexpected/actionable failures → `IErrorReporterPort` (error + Sentry); recovery breadcrumbs → warn with alert coverage; significant operational transitions → info. Callers select failures; the reporter only pairs destinations.
- Preserve HTTP log allowlists; exclude bodies, query strings, and sensitive headers. Keep secrets and unnecessary personal data out of logs, spans, and exception payloads.
- Pass errors directly to the logger; do not copy exception context into log `data`.
- Preserve SDK `parentbased_always_on`; never configure sampler overrides that drop traces before the Collector. Collector tail sampling retains traces with any ERROR span or latency above the configured threshold and samples the remainder by configured percentage; logs/metrics are unsampled. Upstream drops, including unsampled parents, cannot be recovered; downstream sampling must honor the retention policy.
- Route each trace to one tail-sampling Collector; size decision windows/capacity for traffic and late spans. Pending traces/decisions are memory-only: restarts, overload, and late arrivals can lose error evidence or traces.
- Match service/environment attributes across signals and Compose log labels. Generate a fresh `service.instance.id` per SDK startup, preserving env/host/process attributes and overriding static IDs. Exclude trace/user/request IDs from metric dimensions and Loki index labels; exclude instance/task IDs from Loki index labels.
- Collect local Docker logs only with `telemetry.logs: 'true'`; exclude Collector diagnostics.
- Preserve `file_storage` exporter queues and log offsets on the local named volume. Offsets alone do not guarantee delivery; buffers, retry limits, and storage loss can lose telemetry.

### Audit

- `IAuditPort` records evidence, not diagnostics: append-only primary `audit.audit` ([Data & State](data-and-state.md#data--state)), independent of log level/sampling and active in tests. Durability requires outer commit in a transaction, insert completion otherwise. Audit loss is unacceptable.
- Fact owners persist mutation audit in the same DB transaction as the mutation; failure rolls back both. Capture facts, time, trace, and verified context at mutation time. Never defer audit persistence to an event consumer or reconstruct history from current state.
- Use `@Audited` / `AuditInterceptor` only for reads/disclosures: await durable audit acceptance before emitting results; audit failure fails the response, handler failure creates no disclosure record. Filter 403 ownership: [Exceptions](exceptions.md#exceptions); its audit failures follow error reporting without replacing the original response.
- `auditContextHook` (`main.ts`, `onRequest`) seeds transport before guards; authentication adds verified, session-checked identity before authorization. Never publish unverified payloads; interceptors are too late.
- Audit actors travel via AsyncLocalStorage, never command payloads; absent non-HTTP actors leave unattributed records. Business actors remain explicit ([Authentication & Authorization](security-and-sessions.md#authentication--authorization)).
- Callers supply only non-ambient facts. `AuditAction` includes outcome; `actorType` identifies the actor's owning context. Use `targetId` for a distinct subject or actorless action; omit it when the subject is the actor.
- Apply retention and data minimization: no tokens, passwords, or full PII payloads; restrict `AuditDetail` values to identifiers/enums. At the hook, prefer matched route templates, strip queries from unmatched paths, and cap user-agent length.

### Dependency Outages

- Per application instance and client/pool, log observed outage transitions once: `warn` + driver error + `ConnectionLogMessage.LOST`, then `info` + `RESTORED`. Identify the connection; vocabulary belongs in `core/observability/logger`.
- Redis client events own transition logs; PostgreSQL health probes own database-pool transition logs. Keep pool error listeners without duplicate reporting; share the probe when replica aliases primary.
- Suppress duplicate outage logs/Sentry, preserving failure semantics ([Adapters](data-and-state.md#adapters), [Session Versions & Failure Semantics](security-and-sessions.md#session-versions--failure-semantics), [Exceptions](exceptions.md#exceptions), [Events & Messaging](events-and-messaging.md#events--messaging)).
- Require regular external health checks and Grafana Cloud alerts, including separate cache monitoring ([Health Probes](http.md#health-probes)); transition logs are diagnostic.
