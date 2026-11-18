# Exceptions

## Taxonomy & Translation

- Project-thrown failures use the transport-neutral taxonomy in `src/shared/exception`, never Nest HTTP exceptions. Framework-raised HTTP errors remain supported; health passthrough follows [Health Probes](http.md#health-probes).
- Catch only cases defined by the dependency contract; rethrow everything else unchanged. Translate only at the owning boundary and preserve the caught value in `cause`, including 4xx and helper-created translations ([Adapters](data-and-state.md#adapters)).
- Classify taxonomy failures structurally: use `isExceptionOfKind` for a category and `isAppException` for the taxonomy; never use `instanceof`. Native/framework/driver errors without `kind` may use `instanceof`.
- Dependency-availability classifiers walk `cause` chains and match only known availability failures; authentication, configuration, protocol, programming, and unknown failures must not become dependency outages.
- Expected business refusals use the appropriate taxonomy kind; broken/impossible internal paths use diagnostic `SystemException`. Business-rule ownership: [Data & State](data-and-state.md#data--state).
- Keep generic message enums beside their exception classes and free of module-specific vocabulary. Inline single-use messages; shared use-case messages belong in `command.ts`/`query.ts`; other messages follow [Placement & Naming](architecture.md#placement--naming).

## Metadata & Refusal Audit

- `context` follows `ExceptionContext`, is only for system/unexpected-fault diagnostics, and stays separate from logger/audit vocabulary. `AppException.audit` carries optional refusal action/reason independently of `kind` and `context`; neither metadata surface reaches clients.
- Handlers wrap every aggregate call, including factories, validation, and finalization, in refusal-audit handling even when it currently emits no audit metadata. If `isExceptionWithAudit(error)` matches, await the audit with `{ markExceptionAsAudited: error }`, then rethrow the same error; audit failure propagates. Durability: [Audit](observability.md#audit).
- Throwers do not log; reporting belongs to the handling boundary ([Observability](observability.md#observability)).

## HTTP Boundary

- `GlobalExceptionFilter` alone maps taxonomy failures to HTTP. `KIND_TO_STATUS` is exhaustive; unknown failures become 500. Mask 404 and 5xx messages with shared client-safe defaults; preserve documented health-probe passthrough.
- The filter does not report 503 per request; dependency outage reporting is handled separately ([Dependency Outages](observability.md#dependency-outages)). Other 5xx failures go to the error reporter. Unaudited 403 responses record `ACCESS_DENIED`; audit failure is reported without replacing the original 403 response.
