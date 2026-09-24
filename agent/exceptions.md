# Exceptions

- Project-thrown failures use the transport-neutral taxonomy in `src/shared/exception`, never Nest HTTP exceptions. Framework-raised HTTP errors remain supported; health passthrough: [Health Probes](http.md#health-probes).
- Catch only contract-defined cases; rethrow others unchanged. Translation/fail-open: [Adapters](data-and-state.md#adapters); detached failures: [CQRS](architecture.md#cqrs); delivery failures: [Jobs & Messaging](jobs-and-messaging.md#jobs--messaging).
- Keep generic message enums beside their exception classes; never add module-specific vocabulary there. Inline single-use messages; shared use-case messages belong in `command.ts`/`query.ts`, other messages follow [Placement & Naming](architecture.md#placement--naming).
- Business-rule ownership: [Data & State](data-and-state.md#data--state). Expected business refusals use appropriate taxonomy kinds; broken internal paths use diagnostic `SystemException`.
- Optional `AppException.auditReason` carries an internal refusal reason, independent of kind and diagnostic `context`. Handling boundaries use `isExceptionWithAuditReason`, await audit, then rethrow unchanged unless the use-case contract requires translation; the field triggers no automatic audit and never reaches clients.
- `cause` holds underlying errors, including for 4xx. `context` follows `ExceptionContext`, belongs only to system/unexpected faults, and stays independent of logger/audit vocabulary. Neither reaches clients.
- Throwers do not log; reporting belongs to the handling boundary ([Observability](observability.md#observability)). Refusal evidence: [Audit](observability.md#audit).
- `GlobalExceptionFilter` alone maps taxonomy to HTTP through exhaustive `KIND_TO_STATUS` and `ErrorDefaultDto`; unknown errors become 500. Mask 404/5xx messages with their shared defaults; health passthrough: [Health Probes](http.md#health-probes).
- HTTP filter reporting: 503 silent; other 5xx error-log + Sentry, preserving diagnostic context; 403 audit `ACCESS_DENIED`; others silent. Read context only for reported 5xx; never downgrade system faults to warn/info.
