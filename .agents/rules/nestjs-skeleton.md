# NestJS Modular Monolith — Claude Guide

## Project Purpose

Production-ready NestJS backend — strict DDD, Hexagonal Architecture, horizontal scalability, Lift-and-Shift microservices readiness.

## AI Behavior

- **Never run tests, lint, or format automatically** — the user runs them.
- **Do not auto-generate spec/test files** — the user owns tests; generate one **only** when explicitly asked.
- **Documentation first**: every controller endpoint needs `@ApiTags`, `@ApiOperation`, and `ApiDefault*` decorators.
- **Complete implementations only** — no placeholder logic.
- **Enforce architecture**: reject and correct any request contradicting Modular Monolith, DDD, Hexagonal Architecture, or Outbox Pattern before proceeding.
- **No bulk scripts**: change files via editing tools so each diff is reviewable.
- **Keep CLAUDE.md in sync**: mirror every CLAUDE.md change identically into `.agents/rules/nestjs-skeleton.md`.

## Architecture Rules

### 1. Layer Isolation (Dependency Rule)

Dependencies flow strictly inward. Any other import is ILLEGAL.

| Layer             | May import from                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `domain/`         | `src/shared/domain/` only. Pure TypeScript — NO `@nestjs/*`, `drizzle-orm`, `@Injectable()`. Holds Aggregates, Entities, Value Objects, Domain Events.                                     |
| `application/`    | `domain/`, `src/shared/`, and `src/core/` **contracts** (ports, exceptions, types, utils — never core adapters). NOT `infrastructure/` or `presentation/`. MUST NOT throw HTTP exceptions. |
| `infrastructure/` | `application/`, `domain/`, `src/shared/`, `src/core/`. Implements the application ports.                                                                                                   |
| `presentation/`   | `application/`, `src/shared/`, `src/core/`. MUST NOT reach into `domain/`.                                                                                                                 |

### 2. Shared & Core

**`src/shared/`** — pure, framework-free primitives usable by any layer. MUST NOT depend on `src/core/` or `@nestjs/*`. Organized by concept, not by hexagonal layer:

| Concept                         | Contents                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `domain/`                       | Base Aggregate Root & Domain Event; per-context role enums + integration-event enums (`admin/`, `user/`) |
| `application/event/`            | `dispatched-domain-event` type                                                                           |
| `pagination/` `search/` `sort/` | Pure param **types**, constants, enums (not the HTTP DTOs)                                               |

**`src/core/`** — the platform kernel: every cross-cutting concern as **port + adapter + NestJS wiring**, exposed via one barrel per concern. Modules' `application/` depends on core's **contract surface** (ports, exceptions, types, utils) — never its adapters (bound via DI). No business rules or domain entities.

Concerns: `cache`, `config` (ENV + API-version constants), `database` (connection + base Drizzle schema `id`/`createdAt`/`updatedAt`), `doc` (`ApiDefault*` decorators + Swagger config), `email`, `event-bus`, `exception` (core exception classes, `ErrorDefaultDto`, global filter), `http` (`ResponseInterceptor`, pagination/search DTOs, validation decorators/pipes), `inbox-ledger`, `messaging`, `observability` (logger, tracker), `outbox`, `security` (auth guards + `@Public()`/`@Roles()`, hashing, session, token, `@CriticalThrottle()`).

### 3. Module Isolation & Facade Pattern

- Cross-module imports via paths are **ILLEGAL** — use the module's `[ModuleName]Facade` only.
- Facades expose READ/Query only and MUST return **flat DTOs** (no Drizzle objects, no Aggregate Roots).
- `forwardRef()` is **PROHIBITED** — resolve circular deps via EDA.

### 4. CQRS Discipline

- **Commands**: mutate state, return only the affected entity's `id` (or `void`). The Aggregate mutates itself; hand the whole Aggregate to its **writer port**. **Exception**: auth token-generation commands (login, refresh) may return `{ accessToken; refreshToken }` — ephemeral tokens that cannot be re-queried.

    **Layout** — each command in its own sub-folder:

    ```
    application/command/<command-name>/
      command.ts   # Command class; Result type alias co-located here when the command returns a value
      handler.ts   # ICommandHandler<Command, Result>
      index.ts     # folder barrel
      port.ts      # the command's write port (optional; write ports shared across commands go in command/port/)
    ```

    Result types are `type` aliases in `command.ts`. Token commands (`login-admin`, `login-user`, `refresh-token`) share the `{ accessToken; refreshToken }` shape; void commands (`logout`, `logout-all`) have none. Controllers dispatching a non-void command MUST annotate the return type with the imported Result alias; void commands need no annotation.

- **Queries**: NEVER mutate. Read through the **query port** (reader adapter) into its result type. Controllers dispatching a query MUST annotate the return type with that type.
- **Read transport — QueryBus vs. direct port**: use the **QueryBus** only when crossing _into_ the read side from outside — a **controller** or a **Facade** exposing a cross-module read. Code already in the application layer (listener, cron, command handler) MUST `@Inject(TOKEN)` the **query port directly**; a QueryBus hop here is indirection hiding the dependency graph. **Folder consequence**: `handler.ts` present = QueryBus-dispatched, absent = port-invoked. Either way the result type stays in `query.ts`, the contract in `port.ts` — `handler.ts` is the sole transport signal.
- **Every query owns a thin outbound port (ISP).** The handler depends on **one purpose-specific port** exposing only its read — never a broad/foreign port used for a slice (a health-summary handler must not inject full outbox/email ports just for counts). When a read is **composed from other ports**, that composition lives in the port's **adapter**, not the handler: the adapter injects the underlying ports and returns the read-model — true even when just forwarding+merging (the value is the narrowed contract). **Thin ports segregate; adapters consolidate**: implement a module's many thin read-ports with **one reader adapter per data source** (`AdminReaderAdapter` — one `*-reader.adapter.ts` `implements` all of them, injecting the data source once), never one adapter per port. Bind each token via `{ provide: TOKEN_X, useClass: SharedReaderAdapter }`; handlers still see only their thin port.
- **Read-models** — a query's result `type` — are co-located in its `query.ts`; there is no separate `read-model/` folder. Controllers import that type from the query folder — MUST NOT import from `domain/`.
- **Ports live per-role in their own folder**: a query's port in `query/<name>/port.ts`, a command's write port in `command/<name>/port.ts` (or a shared `command/port/`). No module-root `application/port/`.
- Side-effects via BullMQ or `@nestjs/event-emitter`.

### 5. Database Boundaries

- **No cross-module JOINs.** Each module owns its Drizzle schema — no central registry.
- **Soft links only**: store the UUID as a plain string column — no FK constraints.
- **API Composition**: merge multi-module data in RAM via Facade calls.
- **Schema-per-module**: PostgreSQL logical schema named after the bounded context (e.g. `users.users`); only the owner reads/writes its tables.
- **Eventual consistency**: cross-module state reconciled asynchronously via Domain Events — never a synchronous cross-module transaction.

### 6. Sync vs. Async Communication

- **Sync (Facade)**: Read/Query only, or pre-transaction validation.
- **Async (Domain Events)**: required when a mutation must trigger reactions in other modules. Publish via `EventEmitter2`. **In-process domain-event subscribers** (fed by the outbox relay / event bus) live in `application/event/`. Only subscribers to an **external network/transport** (Postgres `LISTEN/NOTIFY`, a broker topic, an inbound webhook) live in `presentation/listener/`.

### 7. Domain Event Discipline

- Events carry ONLY minimal metadata — typically `id` + `occurredOn`. Never the full payload.
- Never trust event data as current — re-read from DB or Facade when the handler runs.

### 8. Transactional Outbox & Reliable Messaging

- Critical Domain Events MUST be inserted into `outbox` in the **same SQL transaction** as the entity write via `run(work, aggregate)`; a Relay Worker emits them afterward.
    - **Exception — `ITransactionalOutboxPort.publish(events)`**: an event with **no local DB state** to be atomic with (e.g. auth refresh-reuse detection, state living only in Redis) is persisted by a single `outbox` INSERT, no surrounding transaction (one INSERT is already atomic). Never `publish` when a DB mutation accompanies the event — that MUST go through `run` so write and event commit together.
- **Never delete an outbox row on success** — update `status`.
- **Consumers MUST be idempotent** — delivery is at-least-once.
- **Inbox (`IInboxPort`) ONLY for effects harmful to repeat** — email, enqueuing a job, an external API call, a non-idempotent DB write. For DB-backed work `runOnce` commits the dedup marker and effect in the **same transaction**; for external effects use `isProcessed`/`markProcessed`.
- **Do NOT add the inbox to an intrinsically idempotent handler** — re-running yields the same state (fixed key/value write, version-guarded or monotonic-max Redis write, effect derived purely from re-readable DB/Facade truth). It only adds a round-trip. Idempotency must hold under duplicate, out-of-order, **and** concurrent delivery, proven for the whole handler — not assumed from one primitive. The inbox does **not** order events; convergence stays the handler's job.
- **On failure**: run a compensating transaction, emit a failure event, write the reason into `status`.
- **Never swallow errors** — `throw err` so the queue retries. Each queue declares its own `defaultJobOptions` (retry/backoff/retention) inline at `BullModule.registerQueue`, tuned to its failure profile — internal infra recovers in seconds (tight backoff), external providers in minutes (longer).

### 9. Dependency Injection

Always use NestJS Custom Providers (TS interfaces are erased at runtime):

1. Define the Symbol token in the same `*.port.ts` file as its port interface.
2. Inject with `@Inject(TOKEN_NAME)` in `application/`.
3. Bind with `{ provide: TOKEN_NAME, useClass: SomeAdapter }` in the module.

Never inject Drizzle ORM into Application or Domain layers.

### 10. Other Rules

- **Stateless**: never store session data in local memory — use Redis.
- **Distributed jobs**: coordinate BullMQ / crons via Redlock to prevent double-execution.

## Coding Conventions

### Naming

Everything is **singular**: folders (`dto/`, `adapter/`) and files (`user.controller.ts`) — never plural.

### File Grouping & Barrels

Four principles favoring **stable, self-describing, location-independent** structure over minimal file counts. Prefer them over any older pattern in the tree; reject requests reintroducing location-coupled names or internal barrels.

1. **Filenames are always descriptive + role-suffixed — never bare `type.ts` / `enum.ts` / `constant.ts`.** A bare role name only reads because its folder supplies meaning, coupling it to location and breaking on move. Use `dispatched-domain-event.type.ts`, `outbox-status.enum.ts` — self-describing in tabs, search, stack traces, autocomplete. Suffixes: `.type.ts`, `.enum.ts`, `.constant.ts`, `.schema.ts`, `.port.ts`, `.adapter.ts`, `.controller.ts`, `.service.ts`, `.cron.ts`, `.listener.ts`, `.processor.ts`, `.aggregate.ts`, `.facade.ts`, `.module.ts`.

2. **Structure by a role's nature, decided once up front — never by current file count.** Deciding by count (the "1 file → flat, 2 → folder" rule) forces a later import-path-churning migration, so fix the choice from the first file:
    - **Architectural collection-roles** — inherently accrue members sharing a contract: `port`, `adapter`, `command`, `query`, `listener`, `cron`, `event`. Each gets its **own folder from the first file** (`outbox/port/outbox-ledger.port.ts` even as the only port). Nothing is promoted, so no path churns.
    - **Bounded/singular roles** — one per module by nature: `schema`, `module`, `facade`, and language-kind files `enum` / `constant` / a lone `type`. Stay **flat** with a descriptive name (`outbox/outbox-status.enum.ts`).
    - **Never open a language-kind folder** (`type/`, `enum/`, `constant/`) as a bucket — folders are for architectural roles only. A concept growing a large type family is the signal to **split it into sub-concepts** (each its own folder), not add a `type/` bucket.

3. **One barrel per module / bounded-context / shared-concept — its public surface. No barrels on internal role-folders.** Barrels are the classic cause of circular deps in layered DDD and hide the dependency graph. A barrel lives at exactly one level — the **concept** boundary; don't conflate three sibling levels:
    - **Layer** (`shared/application/`, a hexagonal subdivision) → **no barrel** (a loose bag of concepts → broad, cycle-prone surface).
    - **Concept** (`module/<ctx>/`, `core/<concern>/`, `shared/application/event/`) → **exactly one barrel** (`index.ts`) as its public API; consumers import from this path.
    - **Role-folder inside a concept** (`.../event/port/`, `outbox/adapter/`) → **no barrel**; import by explicit file path, never `.../index.ts`.

    So `shared/application/event/index.ts` is correct (barrel on the `event` concept); `shared/application/index.ts` is forbidden (barrel on the `application` layer).

4. **Group by feature/bounded-context first, then hexagonal layer, then technical role LAST.** Macro structure screams the domain (`module/<ctx>/domain|application|infrastructure|presentation`), not the framework. Splitting one concept across many kind-folders (`type/`, `enum/`, `constant/`) too early is the package-by-kind anti-pattern.

**Canonical shape** (a cohesive concept, one barrel, descriptive flat files):

```
src/shared/application/event/
  index.ts                            # the concept's only barrel — its public surface
  dispatched-domain-event.type.ts     # descriptive, role-suffixed, location-independent
```

Consumers import from the concept path (`src/shared/application/event`); the barrel resolves it.

### DTOs

| Type         | Prefix      | Example                                          |
| ------------ | ----------- | ------------------------------------------------ |
| Request body | HTTP method | `post-user.dto.ts` → `PostUserDto`               |
| Query params | `query-`    | `query-pagination.dto.ts` → `QueryPaginationDto` |
| Response     | `response-` | `response-user.dto.ts` → `ResponseUserDto`       |
| Error        | `error-`    | `error-default.dto.ts` → `ErrorDefaultDto`       |

- Every DTO class MUST include `@ApiSchema({ name: '...' })` matching the class name without `Dto`.
- Response DTOs MUST use `@Exclude()` at class level + `@Expose()` per property.

### Responses & Errors

- `ResponseInterceptor` wraps all responses — do not wrap manually.
- Throw the framework-agnostic core exception classes (`src/core/exception`, e.g. `ResourceNotFoundException`) — never NestJS HTTP exceptions; the global filter maps them to `ErrorDefaultDto`.
- Use `QueryPaginationDto` for pagination input, `ResponsePaginationDto` for output.

### Exception Responsibility

An exception describes a failure **semantically and transport-agnostically**. The global filter is the **sole translator**, turning it into (1) the HTTP contract (`ErrorDefaultDto`) and (2) the observability decision (log level / Sentry). Nothing else is the exception's job.

- **An exception MUST NOT carry a log record.** `LogPayload` / `AuditLogPayload` are the logger's record shape — built **only** by the filter or by a direct `logger.*` call site. Never construct one to throw: a throw site that assembles a log record has taken over the filter's job and bound `application/` to the logger's schema.
- **`cause` has exactly one meaning: the underlying error** (native `ErrorOptions`). Pass options straight to `super(message, options)` — never hand-roll or unwrap `this.cause`, which silently drops a link of the chain. It stays `unknown` because foreign failures (DB, Redis, providers) cannot be typed; Sentry walks the chain itself.
- **Structured facts travel in `context`, never in `cause`.** `ExceptionContext` is a framework-free `type` in `src/core/exception` carrying only what the throw site knows and the filter cannot re-derive: `origin` (the throwing `class` + `method`), `event`, `reason`, `subjectId`, `role`.
- **`origin` belongs to the exception** — a structured, queryable restatement of `stack`, which cannot be filtered on in Grafana. `event` alone does not identify the throw site (admin and user login both emit `LOGIN_FAILED`). The filter falls back to its own `class` / `method` when `origin` is absent.
- **The log-stream tag (`type: 'AUDIT'`) is NEVER in the exception.** The audit stream exists without exceptions (`LOGIN_SUCCESS`, `EMAILS_RETRIED` are direct `logger.*` audit records), so the tag is the logger's taxonomy: the exception states _what_ failed (`event`), the filter decides _which stream_ the record joins. `context.event`'s presence is itself the audit signal — never add a separate "is security" flag.
- **The failure taxonomy (`event`, `reason`) is exception vocabulary, not logging vocabulary.** It classifies _what failed_, so it belongs with the exception enums (`src/core/exception/enum/`), not under `observability/logger/enum/`. The filter translates it into the audit record's `action`.
- **Exceptions stay HTTP-free** — no `HttpStatus` on the class. The exception-type → status mapping is the filter's, keeping `application/` transport-agnostic.

### Observability (Logging & Exception Tracking)

Decide per catch/branch by asking **"who acts on this, and does the system fix itself?"** — never log or capture reflexively.

- **Sentry (`IExceptionTrackerPort.captureException`) → only when a human must intervene and it will NOT self-heal.** E.g. an event permanently dead-lettered (`DEAD` — data loss), a connection down until restart. Pair with an `error`-level log.
- **`logger.warn` → self-healing failure whose _cause_ is a forensic breadcrumb**, when another signal (metric or existing Sentry alert) already brings someone to the logs. It answers _why_, doesn't alert. Justified only when both hold: (1) something else detects the incident, (2) the warn carries a root cause not available elsewhere. E.g. a relay drain failure (backlog metric brings you in; warn names the cause), a failed `markDead` write (terminal Sentry alert already fired; warn explains the loop).
- **`logger.log` → operationally significant events** possibly needed later for audit/forensics even without failure (e.g. login/auth-state change). Meaningful state transitions, not routine chatter.
- **Silent `catch` → fully self-healing failure nobody will investigate.** Swallow with an explanatory comment; no log, no Sentry. E.g. shutdown-cleanup errors (OS reclaims the socket), a missed daily prune (next run + table-size metrics cover it). The `catch` only stops an unhandled rejection.
- **A self-healing `catch` must not throw** — the outer `finally`/loop bookkeeping (e.g. a single-flight `isDraining` flag) must still run, or the component deadlocks.
- When a branch drops all logging/Sentry, also remove the now-unused `loggerPort` / `exceptionTrackerPort` injections and imports.

### Guards & Auth

- `AuthGuard` (JWT) and `AuthRolesGuard` (roles) are global. Mark public endpoints with `@Public()`.
- Use `@CriticalThrottle()` on sensitive endpoints (login, refresh).

### API Documentation

Before adding raw `@ApiResponse`, check `src/core/doc/decorator/` for existing `ApiDefault*` decorators.

### Environment Variables

Never use `process.env` directly — always `ConfigService` with the `ENV` constant:

```ts
configService.getOrThrow<string>(ENV.JWT_ACCESS_SECRET);
```

### Variable Inlining

- Used once → inline. Used more than once → extract to a named variable.

### Return Types

- **Interfaces**: always annotate explicitly (including `void`/`Promise<void>`).
- **Class implementations**: do NOT annotate `void`/`Promise<void>`; DO annotate all non-void returns.

### `interface` vs `type`

- **`interface`** — a **contract or behavior** a class will `implement`: Ports, Repositories, Service contracts.
- **`type`** — a pure **data shape** with no behavior: Command/Query payloads, results, read-models, unions/intersections, utility compositions (`Pick`, `Omit`, `Partial`), tuples.

Rule: "What does it **do**?" → `interface`. "What does it **contain**?" → `type`.

### Injection Tokens

Each token is defined in the **same `*.port.ts` file as its port interface**. A token tied to no port lives in a descriptive constant file next to what it configures. Always inject via the Symbol token, never by class across module boundaries.

### JSDoc

Every file MUST start with `@file` + `@description`. All exported classes, interfaces, methods, and functions need JSDoc explaining _why_ they exist.

- `@param` MUST NOT include TypeScript types.
- `@throws {ExceptionType}` in curly braces.
- No `@returns` on `void`/`Promise<void>` methods.
- Decorator functions returning a decorator: describe the value, not the raw type.

## Testing Rules

- `vitest.config.mts` sets `restoreMocks: true` — never call `vi.clearAllMocks()` / `vi.resetAllMocks()` / `vi.restoreAllMocks()`.
- Never assert hardcoded validation message strings — use `expect.any(String)` or `expect.stringContaining(...)`.
- **Positive & Negative Path**: verify all mocks called in chronological order with `.toHaveBeenCalledWith(...)`. In negative paths, assert `.not.toHaveBeenCalled()` only on the **immediate next** function — not further downstream.

## What NOT to Do

- No Drizzle, NestJS decorators, or HTTP types inside `domain/` or `application/`.
- No `LogPayload` / `AuditLogPayload` inside a thrown exception — exceptions carry facts in `context`, the filter builds the log record.
- No DB queries across module boundaries — go through the Facade.
- No `any` — ESLint enforces `@typescript-eslint/no-explicit-any`.
- No `process.env` access anywhere except `src/core/config/environment/environment.validation.ts`.
- No skipping `class-validator` decorators on any DTO property.
- No state or uploaded files in local memory or filesystem.

## Directory Structure

Group by bounded-context → hexagonal layer → role. `module/` and everything under it is **singular**.

```
src/
  core/                         # NestJS framework wiring only — no business logic
    cache/  config/  database/  doc/  email/  event-bus/  exception/
    http/  inbox-ledger/  messaging/  observability/  outbox/  security/
  module/                       # Bounded Contexts
    <module>/
      index.ts                  # module barrel — public surface
      <module>.module.ts
      <module>.facade.ts        # public READ API for other modules
      application/
        command/<command-name>/ # command.ts + handler.ts + index.ts (+ port.ts for its write port)
          port/                 # write port(s) shared across the module's commands
        query/<query-name>/     # query.ts (holds the result/read-model type) + port.ts + index.ts
                                #   (+ handler.ts only when QueryBus-dispatched)
        event/                  # in-process domain-event listeners (outbox relay / event bus)
        constant/
      domain/
        aggregate/
        event/                  # domain-event enums
      infrastructure/
        adapter/                # reader + writer adapters implementing application ports
        database/schema/        # module-owned Drizzle schema
      presentation/
        controller/
        dto/
        decorator/              # module-specific (e.g. auth)
  shared/                       # cross-module building blocks (MUST NOT depend on src/core/)
    domain/                     # pure TS — base Aggregate Root & Domain Event; per-context enums + integration-event enums (admin/, user/)
    application/event/          # dispatched-domain-event type
    pagination/  search/  sort/ # shared param types, constants, enums
test/                           # E2E and integration tests
.agents/rules/nestjs-skeleton.md   # mirror of CLAUDE.md — always kept in sync
```

## Commands

| Task                   | Command                   |
| ---------------------- | ------------------------- |
| Dev server             | `npm run start:dev`       |
| Production             | `npm run start:prod`      |
| Unit tests             | `npm run test`            |
| Unit tests (watch)     | `npm run test:watch`      |
| E2E tests              | `npm run test:e2e`        |
| Type check             | `npm run test:type`       |
| Lint                   | `npm run lint`            |
| Lint + fix             | `npm run lint:fix`        |
| Format                 | `npm run format`          |
| DB generate migration  | `npm run db:generate`     |
| DB run migration       | `npm run db:migrate`      |
| DB studio              | `npm run db:studio`       |
| Docker dev up          | `npm run docker:dev:up`   |
| Docker dev down        | `npm run docker:dev:down` |
| Build Swagger JSON     | `npm run build:doc`       |
| Build typed API client | `npm run build:client`    |

## Tech Stack

| Concern            | Technology                                                    |
| ------------------ | ------------------------------------------------------------- |
| Framework          | NestJS v11+ with SWC builder                                  |
| HTTP               | Fastify (`@nestjs/platform-fastify`)                          |
| Database           | Drizzle ORM + PostgreSQL (`postgres` client)                  |
| Cache / Rate Limit | Redis (`ioredis`, `@nest-lab/throttler-storage-redis`)        |
| Queue              | BullMQ (Outbox Pattern & side-effects)                        |
| Email              | Google APIs (Gmail)                                           |
| Hashing            | Argon2                                                        |
| Validation         | `class-validator` + `class-transformer`                       |
| Observability      | Sentry, Pino, OpenTelemetry, Prometheus, Jaeger, Grafana Loki |
| Testing            | Vitest, Supertest, Spectral, Schemathesis                     |
