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
- Payload/result fields and arrays are `readonly`; preserve cache-key/result stability. HTTP edges map read-models to DTOs.
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

- `AuthenticationGuard` (JWT) and `AuthorizationGuard` (permissions) are global; mark public endpoints `@Public()`.
- Use permissions, never roles: static `Permission` names `<context>:<resource>:<action>` and exhaustive `PERMISSION_HOLDER` assign one holder kind in `shared/domain/principal`. Dynamic `permissions text[]` travels verbatim in access tokens; authorization adds no store read.
- Routes use `@Permissions(...)` (all required, holder kind implied) or self-scoped `@PrincipalOnly(PrincipalType.X)`. With neither, any authenticated principal is admitted. `PrincipalType` (`admin`/`user`) means `sub` ownership, not authority.
- Business actors enter commands as verified `Principal` from `@CurrentPrincipal()`, never HTTP; audit transport is separate (§ Audit).

### Administration

- `PrincipalAggregateRoot` owns permissions/counters; `assertAdministrableBy` permits admin actors only, otherwise `SystemException`. It names no permission. `User` adds no rank rule; routes govern cross-kind authority, and admins cannot hold user permissions.
- `Admin` extends the guard (`super` first) and checks requested sets. ROOT (`admin:root`): single-account marker, partial unique index, manual SQL transfer, never API-granted. Only root appoints/dismisses MANAGER (`admin:permission:manage`); others are ordinary.
- Nobody administers root or themselves. Root administers every other tier; managers administer ordinary admins only, including ordinary permissions, bans, and deletion. Every form of administration of a manager requires root.
- Idempotent `PUT …/:id/permission` replaces all permissions. Real changes audit granted/revoked `detail` once and retire access tokens only.
- Bootstrap is planned, absent: insert first admin/full catalog via SQL.

### Session Versions & Failure Semantics

- `sessionVersion`: access acceptance floor/new-token version. `revocationVersion`: refresh floor. Permission changes call `retireAccessTokens` (session counter only); refresh acquires new permissions without login. Ban/delete/password/reuse/logout-all call `revokeAllSessions` (advance session, set refresh floor to it), requiring login.
- Only owning aggregates advance counters. Logout-all emits `LOGOUT_ALL_REQUESTED` and closes auth refresh sessions; owner listeners dispatch `RevokeXSessionsCommand`. `SessionRevocationReason` selects notices only. Auth never guesses Redis versions ahead of DB.
- Redis mirrors `sessionVersion` only; refresh reads revocation floor from primary. Login/refresh monotonic-max write `version:<id>`, renewing refresh-lifetime TTL. Revocation bumps, never deletes; max rejects stale racing login writes.
- Fail closed: missing version → 401, unavailable store → 503. No accepting default for `getVersion()` null or catch around login `setVersion`. Translate recognized session availability failures only; unknown/auth/command/Lua errors propagate.
- Immediate `setVersion` writes in ban/delete/revoke/password/permission handlers remain best-effort; event reconciliation must await writes and propagate failures for retry (§ Events & Messaging). Missing keys deny; stale keys can remain until reconciliation/refresh/expiry. Reliable delivery does not make DB/Redis revocation atomic or immediate.
- Separate Redis stores: session uses AOF (loss logs users out); cache deliberately does not.
- Each credential refusal costs one Argon2 verify: early refusals (unknown/pending/banned) call `simulateVerify` against a boot-built, current-cost hash. Both principal kinds share `login.util.ts` and uniform `CREDENTIALS` responses.

**No rate limiting yet.** Before throttle work read `docs/issue/rate-limiting.md` (design/decisions/build order). No isolated limiters/env settings; no current dependencies on limiting.

## Exceptions

- `src/shared/exception` owns transport-neutral `AppException`, `ExceptionKind`, `AppExceptionOptions`, subclasses, and co-located message enums. Application code throws this taxonomy, never Nest HTTP exceptions; the health transport exception is described in § Health Probes.
- Messages follow throwers: generic kind→shared enum; use case→`command.ts`; single-use→inline; core→own concern; shared commands→module `application/command/` root. No module-specific shared-enum growth. `ApiDefault*` takes `message: string` with shared `DEFAULT`, never enum-typed.
- `core/http` owns `RequestValidationMessage` (`PAYLOAD` / `PARAM`), following `ValidationPipe`, not its shared status's taxonomy.
- Throwers do not log. Reserve `cause` for underlying errors and diagnostic `context: { class: string; method: string; [key: string]: unknown }` for system/unexpected faults, never client-facing 4xx. Context must not depend on logger-owned keys or audit vocabulary; deliberate refusals are audited by their owner or remain silent.
- Aggregates enforce invariants, never trust pre-checks. Already-requested end state → no-op/no event; invalid transition → exception. Client-reachable refusals use client-facing kinds; impossible paths use diagnostic `SystemException`.
- Shared aggregate invariants belong in opt-in bases, never universal `AggregateRoot`. `SoftDeletableAggregateRoot` makes deleted aggregates immutable: every mutator except `markAsDeleted` calls `assertNotDeleted`; writer loads exclude deleted rows, so violation is `SystemException`. Principal holder violations use `InvalidInputException`; admin self/root/tier refusals use `AccessDeniedException`.
- Adapter translation: § Adapters. Unexpected errors remain generic 500 + Sentry, never disguised by extra filter formatting.
- Only `core/exception` filter maps HTTP via exhaustive `KIND_TO_STATUS` into `ErrorDefaultDto`. Except health passthrough, 5xx bodies use generic `DEFAULT`; diagnostics stay in logs/Sentry.
- Filter order: 503 silent; other ≥500 error log + Sentry with verbatim context; 403 audit `ACCESS_DENIED`; rest silent. Only ≥500 reads context; no warn branch. System errors cannot degrade to lesser records. Episode-wide refusals belong to their decider (§ Audit).

## HTTP

### Health Probes

Paths below are relative to the global prefix.

- `/health/live`: Public 204, no checks and no use-case dispatch; dependency outages must not restart healthy processes.
- `/health/ready`: Public dependency checks, bodyless 204/503; container HEALTHCHECK and any Kubernetes readiness probe target this path. Never disclose topology here.
- `/health`: Detailed indicators, requires `Permission.HEALTH_DETAIL_READ`; dependency topology is privileged information.

- `HEALTH_INDICATOR_KEYS` always includes `database` and `database_replica`; both affect readiness. Unconfigured replica health aliases the primary probe, avoiding duplicate outage logs.
- Preserve Terminus's raw `ServiceUnavailableException`: filter `HttpException` passthrough keeps readiness bodyless/detail unnormalized. Taxonomy translation breaks this.
- Session-store outages intentionally block detailed health at the guard (503); use public readiness/connection logs. Cache-only outages do not block authentication.

### HTTP Caching

- `core/http/caching`: `HttpCacheInterceptor` sets policy; `httpCacheHook` (`main.ts` Fastify `onSend`) gives cacheable GET/HEAD 200s weak ETags and matching `If-None-Match` a 304. Errors/missing policies get `no-store`.
- GET/HEAD methods require `@HttpCache(HttpCachePolicy.X)`; others forbid it and get `no-store`. Violations throw `SystemException`. No class decorators: future POSTs would inherit them.
- Use `NO_STORE` for probes/instant state, `PRIVATE_REVALIDATE` for identity-scoped reads (default), and `PUBLIC_REVALIDATE` for identity-free data suitable for a CDN.
- No freshness (`max-age`): server round-trips retain guards/audit/revalidation. Exception only by design for identity-free, non-audited public data. Client stale-while-revalidate owns round-trip reduction.
- ETags do not skip handlers; compute savings belong to CQRS caching. A BFF forwards `If-None-Match` inward and `ETag` / `Cache-Control` / 304 outward with its own fetch cache disabled; the browser owns the validator.

### DTOs & Responses

- Request body: HTTP-method prefix: `post-user.dto.ts` / `PostUserDto`
- Query/response/error prefixes: `query-` / `response-` / `error-` (`QueryPaginationDto`, `ResponseUserDto`, `ErrorDefaultDto`).

- Every DTO: `@ApiSchema({ name, description })`, name = class minus `Dto`, description = purpose sentence. Apply § JSDoc; document property meanings.
- All DTOs use class `@Exclude()` + property `@Expose()`. Mapped types redeclare class exclusion only; property metadata inherits.
- First check `src/core/http/validation/decorator/` for composed validation + `ApiProperty`; override field labels only when non-default. Otherwise use raw validators + `@ApiProperty` for one-off fields.
- Every validator needs a field-label-based custom `message`, never library defaults leaking regex/property names. Boot env validation is exempt: operators need variable names.
- Response DTOs have no raw validators: express all contract constraints through `@ApiProperty` (`minimum`, lengths, items, enum, etc.). Existing composed decorators remain as the common metadata source. Input optional fields use `@IsOptional()`; that does not override the response-validator restriction.
- Every property is `readonly`: required `readonly email!: string`, optional `readonly search?: string`; never combine `!` and `?`. No property may lack its applicable exposure, documentation, and validation decorators.
- Compose field decorators on second use, never first; migrate both uses to centralize limits.
- `ResponseInterceptor` wraps responses; never wrap manually. Use `QueryPaginationDto` for pagination input and `ResponsePaginationDto` for output.

### API Documentation

- Document endpoints first with `@ApiTags`, `@ApiOperation`, and `ApiDefault*`. Check `src/core/doc/decorator/` before adding raw `@ApiResponse`.
- Status descriptions cover all causes: one cause → its message; several → generic default. No endpoint cause-enumeration enums; clients branch on status and runtime messages supply specifics.
- `core/doc` deliberately owns API-wide `APITag` / versioned `doc.config.ts` descriptions; new tags/versions require descriptions at compile time.

## Observability

Telemetry: OTLP→Collector + JSON stdout; store routing in `docker/otel-collector/`, never app code. Observability Compose uses local stores; its header describes intended ECS sidecars. Sentry handles exceptions separately.

- `instrument.ts`: `skipOpenTelemetrySetup: true` prevents Sentry tracer ownership. `tracing.ts` owns OTel, using `SentryContextManager` for exception request scope.
- `@fastify/otel` in `tracing.ts` names spans after matched routes and sets `http.route`. Keep fs/net/dns instrumentation off. `OTEL_SEMCONV_STABILITY_OPT_IN=http` selects stable HTTP metrics (`http_server_request_duration_seconds`); `instrumentation-pg` traces the chosen `pg` driver.
- Sampling: SDK head `OTEL_TRACES_SAMPLER*` + Collector tail policies. Tempo `metrics_ingestion_time_range_slack` > Collector `decision_wait` keeps delayed spans in metrics.
- Handlers never call `ILoggerPort` / `IExceptionTrackerPort`; raised exceptions follow § Exceptions. For other branches, choose by who acts and whether recovery is automatic:

- `captureException`: Human intervention required; failure will not self-heal.
- `logger.warn`: Self-healing failure with a unique root-cause breadcrumb, and an existing metric/Sentry alert already brings someone to investigate.
- `logger.info`: Operationally significant transitions, not routine chatter or auditable facts.
- Silent catch: Fully self-healing failure nobody investigates; explain why, prevent an unhandled rejection, and do not rethrow. Retryable event work must retain failure status, never appear completed.
- Relay failures follow the same reporting policy; monitor pending age, retry backlog, and stalled delivery. Escalate failures requiring intervention; avoid per-attempt duplicate reports.

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

NestJS 11+ / SWC; Fastify; Drizzle / PostgreSQL (`pg`) with optional replica; ioredis; in-process Nest event emitter; Gmail via Google APIs; Argon2; class-validator / class-transformer; Sentry / Pino / OTel Collector / Tempo / Prometheus / Loki / Grafana (including Cloud deployment target); Vitest / Supertest / Spectral / Schemathesis. Queue and rate limiting are not implemented (§ Events & Messaging, § Security & Sessions).
