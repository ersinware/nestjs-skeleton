# NestJS Modular Monolith — Agent Guide

## Working Rules

- Explain guide conflicts and their impact; propose compliant alternatives. Explicit rule revisions are intentional changes.
- Limit work to the task and necessary related updates; exclude unrelated refactors, features, and tests.
- Verify current behavior/structure claims against code/configuration; distinguish implementation from plans.
- Run tests, lint, or formatting only on explicit request; report verification and skipped checks.
- Add/update focused tests as needed for behavior changes or regressions.
- Update guide rules/project descriptions affected by your changes within the same task.
- Guide edits: preserve meaning; state each rule once in its owning section. Cross-reference when useful; use examples/rationale only to resolve ambiguity. Keep ESLint implementation details in configuration comments.

## Purpose & Architecture

Production-ready NestJS reference skeleton: strict DDD, Hexagonal Architecture, horizontal scalability, Lift-and-Shift microservice readiness. Correctness, security, and standards outrank convenience. Keep cloning free of project identity/unfinished features and contexts extractable without rewrites.

### Layer Isolation

Read `eslint.config.mjs` before changing file placement or cross-boundary dependencies. Fix design, never bypass rules; update ESLint and this guide together for intentional boundary changes.

ESLint matrix: types from `boundaries/elements`, cross-element permissions from `boundaries/dependencies`; unlisted cross-element imports forbidden. `own` = same captured module; `any` = any module. Entry points/same-concern imports: § Barrels.

- `shared` → `shared`
- `core`, `coreCqrs`, `bootstrap` → `shared`, `core`
- `domain` → `shared`, own `domain`
- `application` → `shared`, `core`, `coreCqrs`, own `domain`, own `application`
- `infrastructure` → `shared`, `core`, own `domain`, own `application`, own `infrastructure`, any `moduleIndex`
- `presentation` → `shared`, `core`, `coreCqrs`, own `application`, own `presentation`
- `facade` → `coreCqrs`, own `application`
- `moduleIndex` → own `facade`, own `module`
- `module` → `shared`, `core`, `coreCqrs`, own `presentation`, own `application`, own `infrastructure`, own `facade`, any `moduleIndex`

- `src/module/<context>/domain/` and `src/shared/`: no npm or I/O; Node builtins allowed without I/O. Elsewhere, npm remains subject to architectural constraints.
- `src/module/<context>/application/` uses core contracts (ports/exceptions/types/utils), never adapters or direct DB/cache clients. Barrel access does not guarantee symbol suitability (§ Barrels).
- Classify all `src/**/*.ts` except composition roots `src/main.ts` and `src/app.module.ts`; neither may be imported.
- No unresolved/unclassified dependencies, cycles (including same-layer), or self-imports. No devDependencies in `src/` except `*.spec.ts`.
- In `src/` and `test/`, project imports use absolute `src/` or `test/` paths, never relative. Boundaries cover `src/`; test boundaries: § Testing Rules.

### Module Isolation

- Cross-context reads use the owner's read-only facade through a consumer-owned port/adapter (§ Layer Isolation, § CQRS).
- Facades expose queries/read-only prechecks and return flat query read-models, never Drizzle objects, aggregates, or presentation DTOs. Omit facades without cross-context readers.
- Cross-context mutations use events (§ Events & Messaging).
- No `forwardRef()`; redesign cyclic dependencies.

### Dependency Injection

- Port bindings: Symbol token in the interface file; consumers `@Inject(TOKEN)`; module `{ provide: TOKEN, useClass: Adapter }`. One adapter class may serve several ports; use `useExisting` to share an instance.
- Value-parameterized adapters: undecorated classes + `useFactory`.
- Redefined DI constructors must annotate token dependencies with `@Inject` at their new parameter positions, including those forwarded to `super`.
- Register local providers; import modules exporting external providers. No project `@Global()` modules; exceptions: global `ConfigModule` and `EventEmitterModule.forRoot()`. Verify DI wiring separately; ESLint checks import boundaries.

### CQRS

- Commands extend `Command<R>`; return affected id/`void`, except non-requeryable auth `{ accessToken; refreshToken }`. Mutate aggregates through their methods; pass whole aggregates to write ports (§ Adapters).
- Dispatched queries extend `Query<T>`; queries never mutate business state. Infer dispatch results from queries; explicit return signatures use query-owned read-models, never domain types.
- In `src/module/<context>/application/query/<name>/`, keep results in `query.ts`, outbound contracts in `port.ts`; add `handler.ts` for pipeline dispatch, omit it for direct port reads.
- Outbound query handlers use one purpose-specific local port; compose sources behind it in adapters, even for forwarding/merging (§ Adapters). Static permission catalogs need no outbound port.
- Controllers/facades/listeners/crons dispatch through pipelines, never raw buses or direct handler calls. Exceptions: liveness (§ Health Probes), cache eviction (§ Events & Messaging).
- Handlers inject ports directly, never pipelines/buses; write decisions must not use cached reads (§ Data & State).
- Payload/result fields and arrays are `readonly`; preserve cache-key/result stability. HTTP mapping: § DTOs & Responses.
- Pipelines wrap Nest buses, never override their tokens. `CqrsPipelineModule` re-exports `CqrsModule` for handler registration; behavior order belongs in `src/core/cqrs/module.ts`.
- `TracingBehavior`: outermost on both pipelines; one named span per dispatch, recording errors and rethrowing unchanged (§ Exceptions).
- `QueryCachingBehavior`: query-owned opt-in cache-aside via `ICacheableQuery` (`cacheKey()`, `cacheTtlSeconds`). Cache writes are fire-and-forget; catch unexpected rejections, error-log and capture via observability ports without rethrowing.
- `CacheInvalidationBehavior`: `ICacheInvalidatingCommand` opts into awaited best-effort eviction of `invalidatedKeys()` after handler success (§ Events & Messaging).

## Project Structure

Only source pillars:

- `src/shared/`: pure shared contracts and abstractions.
- `src/core/`: technical capabilities and wiring; no business/domain logic.
- `src/module/`: bounded contexts, organized by context → layer → role.

Entry files/imports: § Layer Isolation. Naming/barrels: subsections below.

Module layout; create only needed parts. Omit `domain/` without an owned aggregate:

```text
src/module/<context>/
  index.ts  <context>.module.ts  <context>.facade.ts
  domain/
    aggregate/  event/
  application/
    command/port/       # ports shared by commands
    command/<name>/     # command.ts, handler.ts; local port.ts if needed
    query/<name>/       # files: § CQRS
    event/  cron/
  infrastructure/
    adapter/  <context>.schema.ts
  presentation/
    controller/  dto/  listener/  decorator/
```

Facade eligibility: § Module Isolation. Listener placement: § Events & Messaging.
Tests: colocated `src/**/*.spec.ts`; E2E/integration/architecture tests and support in `test/` (§ Testing Rules).

### Placement & Naming

Within `src/`, group by ownership and reasons to change, never TS kind. Placement priority:

1. Contract-specific payloads/vocabulary stay in the contract file.
2. Other code stays with its owning concept, not its consumers.
3. Shared vocabulary gets a content-named file at the owning concept root.

- Separate contracts whose meanings/change drivers diverge; merge only when they represent the same concept. Split growing concepts into meaningfully named sub-concepts, never arbitrary file/kind buckets.
- Use singular role folders from the first file: adapter, port, command, query, listener, cron, event, controller, dto, decorator, guard, filter, hook, interceptor, pipe.
- Keep module/facade/schema files flat; module schemas: `infrastructure/<context>.schema.ts`. Identify data sources in filenames, not folders (§ Adapters).
- Use kebab-case names and dot-separated suffixes. Concept/use-case names may be plural when meaningful; role folders remain singular.
- No kind/generic buckets or bare filenames (`type`, `enum`, `constant`, `util`, `interface`, `class`, `payload`, `common`, `shared`, `helper`, `misc`); never nest pillar names (`shared`, `core`, `module`) below source pillars.
- Content-named files may use kind suffixes when independently justified by ownership. Prefer architectural roles over implementation kinds: `.adapter.ts`, never `.class.ts`.
- A role file directly inside its concept uses the bare role (`command.ts`, `handler.ts`, `port.ts`, `module.ts`); inside a role folder, include its subject (`adapter/user-reader.adapter.ts`, never `adapter/adapter.ts`).

### Barrels

- Place `index.ts` only at module roots or the deepest independently consumed core/shared concern roots; never in grouping folders, layers, roles, or use cases. No stacked barrels.
- In `src/`, enter another core/shared concern or module through its root barrel. Direct imports within the same concern/module remain subject to § Layer Isolation; tests: § Testing Rules.
- Use explicit named exports, never `export *`; expose only public API needed by existing or explicitly approved consumers. Module barrels expose only their Module and optional Facade.
- Keep internal adapters, behavior classes, and private connection tokens unexported. Public contracts may come from implementation files; public DB client tokens remain infrastructure contracts (§ Layer Isolation).
- Align core/shared barrel roots with ESLint elements; grouping-folder wildcards may already cover additions. `test/architecture/boundaries-element.spec.ts` checks core/shared root-pattern alignment and barrels immediately beneath grouping folders.

## Data & State

- Share aggregate invariants through opt-in bases, never universal `AggregateRoot`. Valid idempotent requests for the existing state are no-ops without events; invalid transitions fail.
- `SoftDeletableAggregateRoot`: concrete mutators call `assertNotDeleted`, except repeat-safe `markAsDeleted`. Writers load only non-deleted aggregates; attempted mutation of a deleted aggregate is `SystemException`.
- Modules own their tables/Drizzle definitions in same-named PostgreSQL schemas; no central table registry. Exception: core owns/writes `audit.audit`; `audit-trail` reads its barrel-exported table via replica. Keep `drizzle.config.ts` schema discovery and `schemaFilter` aligned with schema changes.
- No cross-module JOINs or synchronous transactions. Cross-context references are soft UUID links without foreign keys; compose reads in memory via facades (§ Module Isolation), reconcile mutations via events (§ Events & Messaging).
- Row IDs: UUID v7, generated by creating command handlers for aggregates and schema `$defaultFn` for core tables without aggregates; never `gen_random_uuid()`.
- Listings use `id DESC`; audit uses `occurredAt DESC, id DESC`. Provide indexes supporting filters/order.
- Keep sessions in Redis, never local memory.
- Adapters select `TOKEN_DATABASE_CLIENT` for writes, write-decision reads, and cacheable queries; `TOKEN_DATABASE_REPLICA_CLIENT` for lag-tolerant presentation reads. Missing/empty `DATABASE_REPLICA_URL` aliases primary.

### Adapters

- Keep module aggregate writers and query readers separate: writers load/save aggregates through one write port each; readers return read-models. Read-only modules need no writer (§ CQRS).
- Group source readers by source and relevant thin ports, never one adapter per port. Keep unrelated sources out; composition adapters may combine sources (§ CQRS). Primary/replica readers: `<module>-reader.adapter.ts` / `<module>-replica-reader.adapter.ts`.
- Core adapters follow capabilities (`cache`, `cache-health`, `cache-cleaner`), not forced reader/writer pairs; split divergent responsibilities into meaningful sub-concepts.
- Aggregate rows have `version integer`; `AggregateRoot.version` stays at loaded version (new = 0), never incremented in memory. `save()` conditionally upserts: insert loaded version or update to loaded+1 WHERE stored=loaded. Zero rows → `ResourceConflictException(CONCURRENT_MODIFICATION)`; affected endpoints document 409. No row-lock transaction across load→save/hashing. Independent append-only inserts need no row version; decisions based on other mutable state still need protection. Single-statement updates need no version only when independent of previously read mutable state and enforcing all required conditions atomically.
- Writers translate known owned constraint violations to taxonomy exceptions with `{ cause }`; classifiers live in `src/core/database`. Other DB errors: `throw translateConnectionFailure(error)` → `DependencyUnavailableException` for connection failures, otherwise unchanged. Raw health pings/test cleaners are exempt (§ Exceptions, § Dependency Outages).
- Request-path cache Redis failures fail open: `get: null`, `set/delete: no-op`. Event eviction uses `ICacheEvictionPort`; Redis failures propagate unchanged for retries (§ Events & Messaging). Empty keys throw `SystemException`; serialization/programming errors propagate. Session Redis: § Session Versions & Failure Semantics. Detached-write reporting: § CQRS; awaited failures: § Exceptions.

### Events & Messaging

Required delivery model: transactional outbox + at-least-once delivery. Outbox/relay are not implemented yet; treat missing guarantees as implementation gaps, never exemptions.

- Publish through `IEventPublisherPort` / `TOKEN_EVENT_PUBLISHER_PORT`; only `src/core/event-bus/` uses `EventEmitter2`. Persist events atomically with originating DB changes; acknowledge durable acceptance, not downstream completion. Dispatch only committed events.
- Generate `eventId` once per logical event before persistence; preserve it across retries/replays. Metadata-only `DispatchedDomainEvent` carries `aggregateId` and `eventId`; consumers re-read authoritative state through owned ports/facades, never infer historical state (§ Audit).
- Consumers tolerate duplicate, concurrent, and out-of-order delivery. Prefer idempotent reconciliation; otherwise deduplicate by `(consumer, eventId)` atomically with DB effects. External effects require provider idempotency or explicit duplicate tolerance; use email-provider idempotency when available, otherwise duplicate emails are acceptable.
- In-process subscriptions use `OnAppEvent` in `application/event/`; network ingress uses `presentation/listener/`. Thin listeners dispatch commands owning reads, mutations, and idempotency; pass `eventId` when needed. Cache eviction may call its port directly.
- Await required listener work; propagate failures to the relay. Complete delivery only after all required consumers succeed; preserve failed work for retry/recovery. Relay claims must recover after worker failure and support multiple instances.
- Persist retry state; provide backoff, stalled/failed-delivery monitoring, and replay. Clean delivery/dedup records only under a retention policy covering supported retries/replays (§ Observability).
- Same-module cache eviction combines awaited best-effort pipeline eviction with retryable in-process event eviction, sharing `<module>-cache-key.util.ts`. Event-path failures must remain visible (§ Adapters); idempotent deletion needs no inbox and does not guarantee race-free freshness.
- Keep delivery infrastructure behind ports; use in-process dispatch in the monolith and brokers for extracted consumers without changing application semantics.

## Security & Sessions

### Authentication & Authorization

- Global guards run authentication before authorization; authentication verifies access JWTs and session versions (§ Session Versions & Failure Semantics). `@Public()` skips authentication and provides no verified principal; never combine it with effective authorization requirements.
- Authorize by permissions, never roles. `src/shared/domain/principal/` owns static `Permission` values and exhaustive `PERMISSION_HOLDER`; holder mismatches throw `InvalidInputException`. Use `<context>:<resource>:<action>` (§ Administration exceptions); changing persisted values requires migration.
- Access tokens carry dynamic permission assignments; authorization uses verified claims without additional store reads.
- `@Permissions(...)` requires all listed permissions; `@PrincipalOnly(PrincipalType.X)` restricts caller kind, not resource ownership. Self endpoints derive target IDs from the verified principal. No effective requirements admits any authenticated principal; use deliberately.
- `PrincipalType` identifies the context owning `sub`, not authority. For actor-dependent business rules, pass verified `Principal` from `@CurrentPrincipal()` to commands, never HTTP/JWT objects. Audit context: § Audit.
- Both principal kinds share `login.util.ts` and uniform `CREDENTIALS` refusals. Each credential-login refusal performs one Argon2 verification; unknown/pending/banned accounts use `simulateVerify` with a boot-generated, current-cost hash.

### Administration

- Administrative mutators enforce `assertAdministrableBy` before changes/no-op returns. `PrincipalAggregateRoot` requires an ADMIN actor (`SystemException` otherwise), naming no concrete permission; `Admin` extends it with `super` first. `User` adds no administrative hierarchy; users may hold USER-assigned permissions (§ Authentication & Authorization).
- Operation permissions remain required (§ Authentication & Authorization); tiers never grant them implicitly. Admin administrative mutations forbid self/root targets; manager targets require root. Self/root/tier refusals throw `AccessDeniedException`. Ordinary targets require no actor tier beyond operation permissions. Self-service profile/password changes are separate.
- ROOT = `admin:root`; MANAGER = `admin:permission:manage`; others are ordinary. Only root may appoint/dismiss managers; root is never API-granted. The partial unique index permits at most one root.
- Bootstrap is unimplemented: provision the first root via SQL with admin-holdable permissions. Transfer root only through an atomic SQL operation preserving permission/session/audit rules; the root marker alone grants no operation permissions.
- `PUT …/:id/permission` replaces the full permission set. Unchanged sets cause no writes/events/audit/session updates; real changes audit `granted`/`revoked` (§ Audit) and retire access tokens only (§ Session Versions & Failure Semantics).

### Session Versions & Failure Semantics

- Owning aggregates alone advance DB counters: `sessionVersion` is the access floor/new-token version; `revocationVersion` is the refresh floor. Permission changes call `retireAccessTokens` (session only), preserving refresh with current permissions. Ban/delete/password/reuse/logout-all call `revokeAllSessions` (increment session, copy to revocation), invalidating earlier tokens subject to propagation below.
- Auth requests owner revocation through events, never invents versions. Logout-all emits `LOGOUT_ALL_REQUESTED` and closes refresh sessions; owner listeners dispatch revocation commands. `SessionRevocationReason` selects notices only (§ Events & Messaging).
- Redis mirrors only `sessionVersion`; refresh reads primary auth state and checks `revocationVersion`. Version writes atomically take max and renew refresh-lifetime TTL; revocation bumps, never deletes. Max prevents regression only while the key survives.
- Access checks reject missing versions or tokens below the stored floor (401); recognized session availability failures become `DependencyUnavailableException` (503). Redis authentication/command/Lua and unknown errors propagate unchanged. Never substitute an accepting default or return login/refresh success after required session operations fail.
- Atomic refresh rotation accepts one winner; replay within grace returns 409 without revocation, outside grace returns 401 and requests full revocation.
- Post-mutation Redis updates are best-effort; event reconciliation reads current primary versions, including soft-deleted principals, and awaits writes with failures propagated (§ Events & Messaging). Neither reliable delivery nor max writes make DB/Redis revocation immediate or atomic; stale mirrors can admit old access tokens until synchronization or expiry.
- Use separate Redis stores: session with AOF, cache without. Missing versions deny access; persistence is not lossless revocation. Recovery must address lost keys and restored stale versions.

### Rate Limiting

Unimplemented. Before changes, review `docs/issue/rate-limiting.md`; its proposals are not final. No isolated limiters, dependencies, or environment settings.

## Exceptions

- Project-thrown failures use the transport-neutral taxonomy in `src/shared/exception`, never Nest HTTP exceptions. Framework-raised HTTP errors remain supported; health passthrough: § Health Probes.
- Catch only contract-defined cases; rethrow others unchanged. Translation/fail-open: § Adapters; detached failures: § CQRS; delivery failures: § Events & Messaging.
- Keep generic message enums beside their exception classes; never add module-specific vocabulary there. Inline single-use messages; shared use-case messages belong in `command.ts`/`query.ts`, other messages follow § Placement & Naming.
- Aggregates enforce invariants independently of prechecks. Expected business refusals use appropriate taxonomy kinds; broken internal paths use diagnostic `SystemException`.
- `cause` holds underlying errors, including for 4xx. `context` follows `ExceptionContext`, belongs only to system/unexpected faults, and stays independent of logger/audit vocabulary. Neither reaches clients.
- Throwers do not log; reporting belongs to the handling boundary (§ Observability). Refusal evidence: § Audit.
- `GlobalExceptionFilter` alone maps taxonomy to HTTP through exhaustive `KIND_TO_STATUS` and `ErrorDefaultDto`; unknown errors become 500. Mask 404/5xx messages with their shared defaults; health passthrough: § Health Probes.
- HTTP filter reporting: 503 silent; other 5xx error-log + Sentry, preserving diagnostic context; 403 audit `ACCESS_DENIED`; others silent. Read context only for reported 5xx; never downgrade system faults to warn/info.

## HTTP

### Health Probes

Paths are version-neutral and relative to the global prefix.

- `/health/live`: public, bodyless 204; no checks or dispatch.
- `/health/ready`: public, bodyless 204 when all indicators pass, 503 on indicator failure; never disclose topology.
- `/health`: requires `Permission.HEALTH_DETAIL_READ`; returns indicator details with 200/503.
- Readiness/detail run uncached checks for `HEALTH_INDICATOR_KEYS`: `memory_heap`, `memory_rss`, `database`, `database_replica`, `cache`, `session`. All affect readiness. Replica probe reuse: § Dependency Outages.
- Use readiness for traffic eligibility and liveness for restart/replacement decisions. Verify platform health-check consequences, including load-balancer checks; dependency outages must not restart healthy processes.
- Preserve Terminus `ServiceUnavailableException`: the filter makes readiness 503 bodyless and preserves detailed indicator reports under `error`. Other failures follow § Exceptions; session unavailability can produce a standard guard 503 before detailed checks run.
- Bound check execution within deployment probe timeouts. DB probes use the application's pool acquisition, server statement, and client query timeouts; allow response margin beyond the statement limit and deployment margin beyond acquisition + query waits. DB timeout env values are seconds. HTTP cache policy: § HTTP Caching.

### HTTP Caching

- GET/HEAD handlers require method-level `@HttpCache(HttpCachePolicy.X)`; forbid it on classes/other methods. Missing GET/HEAD or misplaced non-GET/HEAD policies throw `SystemException`; other methods use `no-store`.
- Use `NO_STORE` for probes, tokens, and non-storable data; prefer `PRIVATE_REVALIDATE` for identity-scoped reads. Reserve `PUBLIC_REVALIDATE` for identity-free, shareable data.
- Require revalidation before reuse, preserving guards/audit; allow freshness only by explicit design for identity-free, non-audited public data.
- `core/http/caching`: `HttpCacheInterceptor` sets policy; `httpCacheHook` (`main.ts`, Fastify `onSend`) forces errors/missing policy headers to `no-store` and gives storable GET/HEAD 200 string/Buffer bodies weak ETags; matching `If-None-Match` returns bodyless 304.
- ETags save response transfer, not handler execution (§ CQRS).
- The API is designed to run behind a BFF. Disable BFF fetch caching; forward the browser's `If-None-Match` upstream and `ETag`/`Cache-Control`/304 downstream. Preserve the representation when forwarding its ETag; the browser owns the validator.

### DTOs & Responses

- Body DTOs use HTTP-method prefixes (`post-user.dto.ts` / `PostUserDto`); path/query/output/error DTOs use `param-`/`query-`/`response-`/`error-`.
- Every DTO declares `@Exclude()` and `@ApiSchema({ name, description })`: name = class minus `Dto`; description = purpose. Expose each field with `@Expose()` and document it; property JSDoc explains meaning (§ JSDoc). Mapped DTOs redeclare class decorators, inheriting unchanged field metadata.
- Reuse matching decorators from `src/core/http/validation/decorator/`; override labels only when needed. One-off fields use raw validators + `@ApiProperty`; compose on the second use of the same field contract and migrate both uses.
- Keep OpenAPI constraints aligned with field contracts. HTTP validation errors need field-label-based custom messages, supplied by decorators or constraints.
- Validate inputs; optional fields use direct/inherited/composed `@IsOptional()`. Responses add no raw validators; document constraints through `@ApiProperty` or existing composed field decorators.
- Properties are `readonly`; use `?` for optional fields and `!` for required fields without initialization. Preserve applicable exposure, documentation, and input validation.
- Convert read-models to response DTOs at HTTP edges with `plainToInstance` or explicit DTO construction; return annotations alone do not filter fields (§ CQRS).
- `ResponseInterceptor` alone adds the success `{ data }` envelope; keep 204/304 bodyless. Errors: § Exceptions. Pagination uses `QueryPaginationDto` and `ResponsePaginationDto`.

### API Documentation

- Document endpoint tags, operations, authentication, and success/applicable error responses. Reuse `src/core/doc/decorator/` when status/body contracts match; otherwise use raw Swagger decorators.
- Standard error decorators accept `message: string`, defaulting to the corresponding shared `DEFAULT`, never module-specific enum types.
- Error descriptions cover all causes: masked errors use public defaults (§ Exceptions); otherwise one cause uses its client-safe message, several use a generic description. Validation-only 400s use `RequestValidationMessage.PAYLOAD`/`PARAM`. No endpoint cause-enumeration enums; clients branch on status, not message text.
- Declare payload schemas without outer envelopes; `swagger-document.factory.ts` adds `data`/`error`. Document bodyless responses without body schemas. DTO metadata: § DTOs & Responses; 304 metadata: `@HttpCache` (§ HTTP Caching).
- Keep controller tags aligned with `APITag` in `src/core/doc/doc.config.ts`; add `VERSION_CONFIG` descriptions for every new tag/version.

## Observability

- Grafana Cloud stores telemetry: traces/metrics via OTLP→Collector; JSON stdout via local Collector→Loki. Fargate FireLens→Loki is the deployment plan, not implemented. Keep routing/credentials in deployment configuration, never application code. Sentry owns exception tracking; audit remains in DB.
- Local dev/prod Compose uses the optional `observability` profile and explicit SDK enablement; no local telemetry stores. `OTEL_SDK_DISABLED` controls the app SDK, not stdout logging or the Collector.
- App `OTEL_*` settings belong in app env; Collector settings/Cloud credentials belong in ignored `.env.observability` (template: `.env.observability.example`), never the API container or image. `GRAFANA_CLOUD_OTLP_HEADERS` contains only the Authorization value (`Basic <base64>`), not `Authorization=`.
- Initialize `reflect-metadata` → `instrument.ts` → `tracing.ts` before application imports. OTel owns tracing; retain Sentry `skipOpenTelemetrySetup: true` and `SentryContextManager`.
- Keep Fastify route-based spans/`http.route`, stable HTTP metrics (`OTEL_SEMCONV_STABILITY_OPT_IN=http`), and pg instrumentation; disable fs/net/dns instrumentation. Preserve active trace context and Pino `traceId`/`spanId` correlation.
- Handlers never call logger/tracker ports. Report at the owning boundary (§ Exceptions, § CQRS): unexpected/actionable failures → error + Sentry; self-healing failures needing a diagnostic breadcrumb → warn with established alert coverage; significant operational transitions → info. Audit facts: § Audit; connection episodes: § Dependency Outages.
- Swallow failures silently only where the contract permits fail-open/automatic recovery; explain why and handle rejections. Retryable delivery must remain failed (§ Events & Messaging).
- Monitor relay backlog age, retries, and stalls; escalate actionable failures without duplicate per-attempt reports (§ Events & Messaging).
- Default SDK head sampling to `parentbased_traceidratio` / `1` for Grafana Cloud Adaptive Traces; coordinate upstream BFF sampling, since head-dropped traces cannot be recovered, including unsampled parents. Collectors only forward; no local tail sampling.
- Match service/environment resource attributes across signals; Compose log labels must match app OTel attributes. Local Docker log collection requires `telemetry.logs: 'true'`; exclude Collector diagnostics. Keep trace/user/task IDs out of Loki index labels. Configure Grafana correlations against emitted fields; preserve Pino field names rather than renaming them to UI labels.
- Local Collector exporter queues and log read offsets use `file_storage` on a named volume; offsets alone do not guarantee delivery. Pre-queue buffers, bounded retries/capacity, and storage loss still prevent end-to-end delivery guarantees; `down:clean` deletes the queue volume. AWS storage/routing configuration is deferred to deployment.

### Audit

`IAuditPort` is evidence (who/what/when/where), `ILoggerPort` diagnostics. Audit: append-only primary `audit.audit`, independent of log level, active in tests. Loss is unacceptable; current non-atomic writes are an implementation gap:

- Fact owners must atomically persist mutation audit evidence or its immutable delivery record with the mutation (§ Events & Messaging). Capture facts/time/trace/actor/context before deferral; preserve record identity across retries, never reconstruct history from current state. Current commands await `auditPort.record()` after writes; failures propagate until atomic persistence replaces this path.
- Edges own filter 403s (§ Exceptions) and `AuditInterceptor` / `@Audited` reads/disclosures (`PERSONAL_DATA_ACCESSED`, `AUDIT_TRAIL_ACCESSED`). Never `@Audited` mutations. Filter audit failures re-enter its error decision without throwing/changing the response.
- Record refusal episodes once at their deciding component (future limiters/breakers), never the filter that cannot distinguish triggering/affected requests. Per-request evidence amplifies writes regardless of log level.
- `auditContextHook` (`main.ts`, `onRequest`) seeds transport before guards; authentication adds verified, session-checked identity before authorization. Never publish unverified payloads; interceptors are too late.
- Audit actors travel via AsyncLocalStorage, never command payloads; absent non-HTTP actors leave unattributed records. Business actors remain explicit (§ Authentication & Authorization).
- Pass only non-ambient facts. `targetId` means distinct subject, not self-scoped actor duplication: administration, actorless public routes, or a different credential (logout refresh token).
- Audit is personal data with policy-bound retention. Never record tokens, passwords, or full PII payloads. `detail: AuditDetail` jsonb holds identifier/enum changes; `actorType` identifies the context owning `actorId`. Sanitize transport facts at the hook: matched route template, or unmatched path without query string; cap user-agent length.

### Dependency Outages

Record connection transitions once per episode: `isDown` gates `warn` with driver error + `ConnectionLogMessage.LOST`, then `info` + `RESTORED`. The shared vocabulary lives in `core/observability/logger`.

- Redis concerns share connection events in `core/cache/redis-client.factory.ts`. PG idle-client errors are swallowed in `database-pool.factory.ts`; one `DatabaseHealthAdapter` per connection tracks probe transitions via `isDown`, identified by `data.role`. Reuse the primary probe when replica aliases primary.
- Downstream availability failures stay silent (cache misses/session best-effort writes/filter 503s). Health alarms detect; transition logs explain without flooding.

## Coding Conventions

### JSDoc

- Files start with matching `@file` + `@description`; classes/interfaces/methods/functions require purpose/rationale JSDoc.
- Comments explain current rationale briefly, never filler/history/code narration. No TS types in `@param`; use `@throws {ExceptionType}`.
- Interface methods own `@throws`, not implementations: taxonomy, health/cleaner rejection, caller-caught library failures. Facades document all contract throws, including propagated taxonomy. Omit universal unexpected-500 tags.
- No `@returns` for `void` / `Promise<void>`; decorator factories describe the returned value, not its raw type.

### Types, Signatures & Variables

- `interface` describes implementable behavior/contracts (ports, repositories, services); `type` describes data (payloads, results, read-models, unions, intersections, utilities, tuples).
- Keep `exactOptionalPropertyTypes` on; ban `?: X | undefined`. Omit absent keys with conditional spread, never assign conditional `undefined`. For `unknown`, narrow with an explicit boolean check (`x !== undefined`) before spreading. Drizzle update-set column exclusion is exempt (`id: undefined`, also `createdAt` in current writers).
- Interface returns are always explicit, including void. Class implementations omit `void` / `Promise<void>` annotations and explicitly annotate non-void returns.
- Exhaust enum/union decisions: switch defaults call a local `never` guard throwing `SystemException`; maps use `satisfies Record<Enum, T>`. Ternaries require type-closed two-member unions.
- Used once → inline; used more than once → named variable.

### Environment & Route Constants

- Numeric app duration env values use seconds; convert at library boundaries when milliseconds are required. String TTLs carry explicit units (`s`/`m`/`h`/`d`).
- Validate env values by consumer semantics: integer counts/ports, decimal durations, explicit booleans, URL/email formats and closed choices. Disable implicit env conversion; explicitly transform numbers/booleans. Reject blank/boolean numeric coercion; preserve intentional empty-value contracts. Numeric bounds enforce valid consumer inputs and driver limits, never arbitrary capacity policy.
- Read app env via `ConfigService` + `ENV`: typed `getOrThrow` for required values. Optional: `?:`, `@IsOptional()`, `@Transform(emptyToUndefined)`, `get`; readers also treat empty as unset because raw-env fallback can restore dropped keys.
- Repeated env reads become constructor-initialized `private readonly` fields (one key/type, required failures at boot); single reads stay inline.
- Direct `process.env`: pre-DI instrumentation/tracing and `core/config` `trustProxy` / `envFilePath` resolvers only. Interpret, do not validate; fail safe. App contracts remain boot-validated in `EnvironmentVariables`.
- Repeated route fragments are owner-local constants. App mounts: `core/config` (`GLOBAL_PREFIX`, `VERSION_PREFIX`, `ROUTE_HEALTH*`, `ROUTE_DOCS`, derived `PATH_HEALTH*`). `PARAM_ID` / `ROUTE_PARAM_ID` accompany `ParamIdDto` in `core/http`, linked by `satisfies`.
- Core health constants deliberately let filter/controller share exact passthrough paths without core importing a module.

## Testing Rules

- `vitest.config.mts` enables `restoreMocks` and `clearMocks`; do not manually call `vi.clearAllMocks()` / `vi.resetAllMocks()` / `vi.restoreAllMocks()`.
- Never hardcode validation messages in assertions; use `expect.any(String)` or `expect.stringContaining(...)`.
- In positive/negative paths, verify mock calls in chronological order and their arguments with `.toHaveBeenCalledWith(...)`. In negative paths assert `.not.toHaveBeenCalled()` only for the immediate next function, not farther downstream.
- Test boundaries remain TODO: direct writer imports are allowed. Remind the user during test structure/import work. Undecided proposal: `test/api/**` → module barrels/presentation for HTTP E2E, looser integration element. Other import restrictions: § Layer Isolation, § Events & Messaging.

## Reference Stack

NestJS 11+ / SWC; Fastify; Drizzle / PostgreSQL (`pg`) with optional replica; ioredis; in-process Nest event emitter; Gmail via Google APIs; Argon2; class-validator / class-transformer; Sentry / Pino / OTel Collector / Grafana Cloud (Loki logs, managed traces/metrics); Vitest / Supertest / Spectral / Schemathesis. Queue and rate limiting are not implemented (§ Events & Messaging, § Security & Sessions).
