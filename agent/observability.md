# Observability

## Signal Ownership & Data Safety

- OpenTelemetry is the sole owner of application tracing and metrics; Sentry is exception tracking only. Keep one tracing provider/context owner and initialize telemetry before application imports that require auto-instrumentation.
- Keep service and environment identity consistent across signals and preserve trace-to-log correlation.
- Keep metric dimensions and indexed log labels low-cardinality. Never use user, request, trace, delivery, job, or other unbounded identifiers as metric dimensions or indexed labels.
- Minimize telemetry data. Do not record secrets, tokens, request/response bodies, query strings, sensitive headers, whole job payloads, or unnecessary personal data in logs, spans, metrics, or exception tracking.
- Logs, traces, metrics, and exception tracking are diagnostic signals. They never replace durable audit evidence.

## Failure Reporting

- Report a failure once at the boundary that owns handling it; lower layers throw or translate according to [Exceptions](exceptions.md#exceptions) rather than capturing the same failure repeatedly.
- Unexpected or actionable failures use structured error reporting and exception tracking. Self-healing or recovery-relevant failures use `warn`; significant operational transitions use `info`.
- Known dependency availability outages are handled by [Dependency Outages](#dependency-outages), not reported once per failed request or job.
- Preserve the original error for logging/tracking and attach only necessary, non-sensitive operational context. Do not duplicate exception payloads or diagnostic context into free-form log data.
- Queue-boundary reports may include queue and delivery identities needed for correlation, but never include the full job payload.

## Tracing

- Do not add application-side or Collector-side trace sampling. Honor upstream parent sampling decisions and leave retention/downsampling policy to the observability backend.
- Durable delivery attempts start new root consumer spans and link to the producer context when valid trace metadata exists. Missing or malformed trace metadata must never block delivery.
- Traces should show only meaningful application and dependency work. Preserve HTTP route attribution and trace-log correlation; low-diagnostic-value, high-volume technical spans must not unnecessarily inflate traces.

## Audit

- Audit is durable evidence, not diagnostic telemetry. Keep it append-only, persisted on the primary store, independent of log levels and sampling, and fail-closed when evidence is required.
- The context that owns an audited event owns its action vocabulary. Shared cross-context events use shared vocabularies. Reuse one stable action for the same event and preserve persisted action values across refactors.
- Persist mutation audit with the state change and required durable follow-up work in the same transaction. If that transaction rolls back, its success evidence must roll back with it.
- Refusal evidence that must survive a failed mutation commits independently of the mutation transaction. Do not record in request context that the exception has been audited until the refusal audit record has committed successfully.
- Read/disclosure evidence must be durably accepted before the result is emitted; a failed handler produces no successful disclosure record.
- Record facts at the time they become true. Do not defer producer evidence to a later consumer or reconstruct historical facts from current state.
- `actor` identifies who acted; `target` identifies a distinct subject. Self-service actions normally omit a duplicate target, while explicit administrative or disclosure targets remain recorded even when identifiers happen to match.
- Audit details contain only the minimum evidence needed for investigation: identifiers, bounded vocabulary, and relevant counters/versions. Never store credentials, tokens, secrets, or full personal-data payloads.

## Dependency Outages

- Record one outage transition and one recovery transition per independently meaningful dependency connection or pool. Do not flood logs or exception tracking for every request/job that observes the same known outage.
- Monitor independently meaningful connection paths separately. Health of one client, replica, pool, or queue connection does not prove another is healthy.
- Suppressing duplicate outage logs or reports must not change application failure behavior; dependency failures must still propagate to callers with their intended exception or return semantics.
- Health-check behavior remains owned by [Health Probes](http.md#health-probes).

## Dead-letter Monitoring

- Shared DLQ monitoring has one active owner per deployment unless an explicit coordination mechanism provides equivalent semantics; replica count must not multiply shared-state metrics.
- Monitor DLQ backlog, failed redrive state, and monitor health independently. These are operational alerts and do not make an otherwise healthy application instance unready.
- Publish business gauges only from complete samples. Sampling failure marks monitoring unhealthy and must not turn unknown/stale state into a healthy zero.
- Alert rules, thresholds, and no-data behavior are defined in Grafana, not in application code.
