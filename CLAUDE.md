# NestJS Modular Monolith — Claude Guide

## Project Purpose

Production-ready NestJS backend — strict DDD, Hexagonal Architecture, horizontal scalability, Lift-and-Shift microservices readiness.

## AI Behavior

- **Never run tests, lint, or format automatically** — user runs them manually.
- **Do not auto-generate spec/test files** — the user owns and writes tests separately, on their own schedule. Generate a spec **only** when the user explicitly asks for it.
- **Documentation first**: every controller endpoint needs `@ApiTags`, `@ApiOperation`, and `ApiDefault*` decorators.
- **Complete implementations only** — no placeholder logic.
- **Enforce architecture**: reject any request that contradicts Modular Monolith, DDD, Hexagonal Architecture, or Outbox Pattern; warn the user and enforce the correct approach first.
- **No bulk scripts**: all changes via file-editing tools so the user can review each diff.
- **Keep CLAUDE.md in sync**: whenever CLAUDE.md is updated, apply the identical change to `.agents/rules/nestjs-skeleton.md`.

## Architecture Rules

### 1. Layer Isolation (Dependency Rule)

Dependencies flow strictly inward. Any other import is ILLEGAL.

| Layer             | May import from                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/`         | `src/shared/domain/` only. Pure TypeScript — NO `@nestjs/*`, NO `drizzle-orm`, NO `@Injectable()`. Holds: Aggregates, Entities, Value Objects, Domain Events, Port interfaces, base exceptions. |
| `application/`    | `domain/`, `src/shared/`. MUST NOT import `infrastructure/` or `presentation/`. MUST NOT throw HTTP exceptions.                                                                                 |
| `infrastructure/` | `application/`, `domain/`, `src/shared/`, `src/core/`. Implements `domain/` ports.                                                                                                              |
| `presentation/`   | `application/`, `src/shared/`, `src/core/`. MUST NOT reach into `domain/` directly.                                                                                                             |

### 2. Shared & Core

**`src/shared/`** — project-wide building blocks shared by all modules. MUST NOT depend on `src/core/`. Organized into the same 4 layers as a module:

| Layer             | Rule                                                           | Contents                                                                                                                                         |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `domain/`         | Pure TypeScript — ZERO inter-module communication dependencies | Base Aggregate Root, Base Domain Event, Base Value Object, base domain exceptions                                                                |
| `application/`    | Shared use-case contracts                                      | Shared DTOs (pagination, search, validation), Port interfaces (cache, database, email, logger, security) with injection tokens                   |
| `infrastructure/` | Persistence helpers                                            | Base Drizzle schema (common columns: `id`, `createdAt`, `updatedAt`)                                                                             |
| `presentation/`   | NestJS / HTTP artifacts only                                   | Auth guards, auth decorators (`@Public()`, `@Roles()`), `ApiDefault*` Swagger decorators, `@CriticalThrottle()`, validation decorators and pipes |

**`src/core/`** — NestJS framework wiring only (DB connection, email, security, throttle, logger, outbox relay). No business rules or domain entities.

### 3. Module Isolation & Facade Pattern

- Cross-module imports via relative/absolute paths are **ILLEGAL** — use the module's `[ModuleName]Facade` only.
- Facades expose READ/Query operations and MUST return **flat DTOs** (no Drizzle objects, no Aggregate Roots).
- `forwardRef()` is **STRICTLY PROHIBITED** — resolve circular deps via EDA.

### 4. CQRS Discipline

- **Commands**: mutate state, return only the affected entity's `id` (or `void`). Aggregate mutates its own state; hand the whole Aggregate to the repository. **Exception**: auth token–generation commands (login, refresh) may return the generated token pair as a plain application-layer object `{ accessToken: string; refreshToken: string }` — tokens are ephemeral artifacts that cannot be re-queried after generation.

    **Command folder layout** — each command lives in its own sub-folder with exactly two files:

    ```
    application/command/
      <command-name>/
        command.ts   # Command class; Result type alias co-located here when the command returns a value
        handler.ts   # ICommandHandler<Command, Result> implementation
    ```

    Result types are `type` aliases (not `interface`) defined in `command.ts`. Token-returning commands (`login-admin`, `login-user`, `refresh-token`) use the shared shape `{ accessToken: string; refreshToken: string }`. Commands that return `void` (`logout`, `logout-all`) have no Result type in `command.ts`.

    Controller methods dispatching a non-void command MUST annotate their return type using the imported Result type alias. Void-returning commands need no return type annotation on the controller method.

- **Queries**: MUST NEVER mutate state. Read directly from the **query repository** into a read-model DTO. Controller methods dispatching a query MUST annotate their return type using the read-model type.
- **Read transport — QueryBus vs. direct port**: dispatch a read through the **QueryBus** only when crossing *into* the read side from outside it — from **presentation (controllers)** or a **Facade** exposing a cross-module read. Code already inside the application layer (a **listener**, cron, or command handler) that needs a read MUST inject the **query port directly** (`@Inject(TOKEN)`); routing an intra-layer read through the QueryBus is pure indirection that hides the dependency graph. **Consequence for the folder shape**: a query **with a `handler.ts` is QueryBus-dispatched**; a query **without a `handler.ts` is port-invoked** from within the application layer. Either way the result/read-model type stays in `query.ts` and the outbound contract in `port.ts` — the presence or absence of `handler.ts` is the sole signal of the transport.
- **Read-models** live in `application/query/read-model/` — plain interfaces, zero runtime cost.
- **Query port** (`application/port/*.port.ts`) lives in `application/`.
- Presentation controllers import read-models from `application/query/read-model/` — MUST NOT import from `domain/`.
- Side-effects via BullMQ or `@nestjs/event-emitter`.

### 5. Database Boundaries

- **No cross-module JOINs.** Each module owns its Drizzle schema — no central schema registry.
- **Soft links only**: store only the UUID as a plain string column — no FK constraints.
- **API Composition**: merge data from multiple modules in RAM via Facade calls.
- **Schema-per-module**: PostgreSQL logical schema named after the bounded context (e.g. `users.users`). Only the owner reads/writes its tables.
- **Eventual consistency**: cross-module state reconciled asynchronously via Domain Events — never via synchronous cross-module transactions.

### 6. Sync vs. Async Communication

- **Sync (Facade)**: Read/Query only, or pre-transaction validation.
- **Async (Domain Events)**: Required when a mutation must trigger reactions in other modules. Publish via `EventEmitter2`; subscribers live in `presentation/listener/`.

### 7. Domain Event Discipline

- Events carry ONLY minimal metadata — typically `id` + `occurredOn`. Never embed the full payload.
- Never trust event data as current — re-read from DB or fetch via Facade when the handler runs.

### 8. Transactional Outbox & Reliable Messaging

- Critical Domain Events MUST be inserted into `outbox` in the **same SQL transaction** as the entity write. A Relay Worker emits them afterward.
- **Never delete an outbox row on success** — update `status` instead.
- **Consumers MUST be idempotent** — the same event can be delivered more than once (at-least-once).
- **Inbox (`IInboxPort`) ONLY for effects that are harmful to repeat** — sending email, enqueuing a job, calling an external API, or a non-idempotent DB write. For DB-backed work `runOnce` commits the dedup marker and the effect in the **same transaction** (atomic "done" + "recorded-done"); for external effects use `isProcessed`/`markProcessed`.
- **Do NOT add the inbox to an intrinsically idempotent handler** — one where re-running yields the same state (fixed key/value write, version-guarded or monotonic-max Redis write, or an effect derived purely from re-readable DB/Facade truth). It only adds a DB round-trip. Idempotency must hold under duplicate, out-of-order, **and** concurrent delivery, proven for the whole handler — not assumed from one primitive. The inbox does **not** order events; convergence stays the handler's own job.
- **On failure**: run a compensating transaction, emit a failure event, write the reason into `status`.
- **Never swallow errors** — `throw err` so the queue retries. Each queue declares its own `defaultJobOptions` (retry/backoff/retention) inline at `BullModule.registerQueue`, tuned to that queue's failure profile — internal infra recovers in seconds (tight backoff), external providers in minutes (longer backoff).

### 9. Dependency Injection

Always use NestJS Custom Providers (TypeScript interfaces are erased at runtime):

1. Define a Symbol token in `domain/constant/`.
2. Inject with `@Inject(TOKEN_NAME)` in `application/`.
3. Bind with `{ provide: TOKEN_NAME, useClass: RepositoryImpl }` in the module.

Never inject Drizzle ORM directly into Application or Domain layers.

### 10. Other Rules

- **Stateless**: never store session data in local memory — use Redis.
- **Distributed jobs**: coordinate BullMQ / crons via Redlock to prevent double-execution.

## Coding Conventions

### Naming

Everything is always **singular**: folders (`dto/`, `repository/`) and files (`user.controller.ts`) — never plural.

### File Grouping & Barrels

These four principles govern how files are named, grouped, and exported. They favor **stable, self-describing, location-independent** structure over minimal file counts. Prefer them over any older pattern already in the tree — reject requests that reintroduce location-coupled names or internal barrels.

1. **Filenames are always descriptive + role-suffixed — never bare `type.ts` / `enum.ts` / `constant.ts`.** A bare role name only reads because its parent folder supplies the meaning, which couples the name to its location and breaks on move/refactor. Use `dispatched-domain-event.type.ts`, `outbox-status.enum.ts`, `claimed-outbox-event.type.ts` — self-describing in editor tabs, global search, stack traces, and import autocomplete. Role suffixes: `.type.ts`, `.enum.ts`, `.constant.ts`, `.schema.ts`, `.port.ts`, `.adapter.ts`, `.controller.ts`, `.service.ts`, `.cron.ts`, `.listener.ts`, `.processor.ts`, `.aggregate.ts`, `.facade.ts`, `.module.ts`.

2. **Structure by a role's nature, decided once up front — never by its current file count.** Counting files today (the "1 file → flat, 2 files → folder" rule) forces a later migration that churns import paths, so the choice must be nature-based and fixed from the first file:
    - **Architectural collection-roles** — inherently accrue members and share a contract: `port`, `adapter`, `command`, `query`, `listener`, `cron`, `event`, `read-model`. Each gets its **own role-folder from the very first file** (`outbox/port/outbox-ledger.port.ts` even when it is the only port). Nothing is ever promoted, so no path ever churns.
    - **Bounded/singular roles** — one per module by nature: `schema`, `module`, `facade`, and the language-kind files `enum` / `constant` / a lone `type`. These stay **flat** with a descriptive name (`outbox/outbox-status.enum.ts`, `outbox/claimed-outbox-event.type.ts`).
    - **Never open a folder for a language-kind** (`type/`, `enum/`, `constant/`) as a dumping bucket. Folders are for architectural roles only. A concept genuinely growing a large family of types is the signal to **split the concept into sub-concepts** (each its own folder), not to add a `type/` bucket — this keeps any count threshold out of the decision entirely.

3. **One barrel per module / bounded-context / shared-concept — as its public surface. No barrels on internal role-folders.** Barrels are the classic cause of circular dependencies in layered DDD and hide the real dependency graph. A barrel lives at exactly one level — the **concept** boundary that closes to the outside — and three sibling levels must not be conflated:
    - **Layer** (`shared/application/`, a hexagonal-layer subdivision) → **no barrel** (loosely-coupled bag of concepts → a broad, cycle-prone surface).
    - **Concept** (`modules/<ctx>/`, `core/<concern>/`, `shared/application/event/`) → **exactly one barrel** (`index.ts`) as its public API. Consumers import from this path.
    - **Role-folder inside a concept** (`.../event/port/`, `outbox/adapter/`) → **no barrel**; import by explicit file path (`outbox/port/outbox-ledger.port.ts`), never `outbox/port/index.ts`.

    So `shared/application/event/index.ts` is correct (barrel on the `event` concept) while `shared/application/index.ts` is forbidden (barrel on the `application` layer).

4. **Group by feature/bounded-context first, then by hexagonal layer, and technical role LAST.** Macro structure screams the domain (`modules/<ctx>/domain|application|infrastructure|presentation`), not the framework. Splitting a single concept across many kind-folders (`type/`, `enum/`, `constant/`) too early is the package-by-kind anti-pattern — a change to one concept then touches many folders.

**Canonical shape** (a cohesive concept with one barrel and descriptive flat files):

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

- All DTO classes MUST include `@ApiSchema({ name: '...' })` matching the class name without `Dto`.
- Response DTOs MUST use `@Exclude()` at class level + `@Expose()` at property level.

### Responses & Errors

- `ResponseInterceptor` wraps all responses — do not wrap manually.
- Throw NestJS HTTP exceptions; global filter formats via `ErrorDefaultDto`.
- Use `QueryPaginationDto` for pagination input, `ResponsePaginationDto` for output.

### Observability (Logging & Exception Tracking)

Decide per catch/branch by asking **"who acts on this, and does the system fix itself?"** — never log or capture reflexively.

- **Sentry (`IExceptionTrackerPort.captureException`) → only when a human must intervene and the condition will NOT self-heal.** Examples: an event permanently dead-lettered (`DEAD` — data loss), a listener/connection that stays down until restart (config/auth failure). These pair with an `error`-level log.
- **`logger.warn` → self-healing failure whose *cause* is worth a forensic breadcrumb** when another signal (a metric or an existing Sentry alert) will already bring someone to the logs. Its job is to answer _why_ during an incident, not to alert. Justified only when both hold: (1) something else detects the incident, (2) the warn carries a root cause not readily available elsewhere. Examples: a relay drain failure (backlog metric brings you in; warn names the cause), a failed `markDead` write (the terminal Sentry alert already fired; warn explains the loop).
- **`logger.log` → operationally significant events that may be needed later** for audit/forensics even with no failure (e.g. a user login/auth-state change). Use for meaningful state transitions, not routine chatter.
- **Silent `catch` → fully self-healing failure that nobody will ever investigate.** Swallow with an explanatory comment; add no log and no Sentry. Examples: shutdown-cleanup errors (the OS reclaims the socket), a missed daily prune (next run + table-size metrics cover it). The `catch` exists only to stop an unhandled rejection.
- **A `catch` that self-heals must not throw** — the outer `finally`/loop bookkeeping (e.g. a single-flight `isDraining` flag) must still run, or the component deadlocks.
- When a branch drops all logging/Sentry, also remove the now-unused `loggerPort` / `exceptionTrackerPort` injections and their imports.

### Guards & Auth

- `AuthGuard` (JWT) and `AuthRolesGuard` (roles) are global. Mark public endpoints with `@Public()`.
- Use `@CriticalThrottle()` on sensitive endpoints (login, refresh).

### API Documentation

Before adding raw `@ApiResponse`, check `src/shared/presentation/doc/decorator/` for existing `ApiDefault*` decorators.

### Environment Variables

Never use `process.env` directly — always use `ConfigService` with the `ENV` constant:

```ts
configService.getOrThrow<string>(ENV.JWT_ACCESS_SECRET);
```

### Variable Inlining

- Used once → inline. Used more than once → extract to a named variable.

### Return Types

- **Interfaces**: always annotate explicitly (including `void`/`Promise<void>`).
- **Class implementations**: do NOT annotate `void`/`Promise<void>`; DO annotate all non-void returns.

### `interface` vs `type`

- **`interface`** — use when defining a **contract or behavior** that a class will `implement`: Port interfaces, Repository interfaces, Service contracts.
- **`type`** — use for pure **data shapes** with no behavior: Command/Query payloads, result objects, read-models, union/intersection types, utility type compositions (`Pick`, `Omit`, `Partial`), and tuples.

Decision rule: "What does this thing **do**?" → `interface`. "What does this thing **contain**?" → `type`.

### Injection Tokens

All injection tokens MUST be defined in a single centralized file per module: `application/constant/injection.constant.ts`. Always inject via Symbol token, never by class across module boundaries.

### JSDoc

Every file MUST start with `@file` + `@description`. All exported classes, interfaces, methods, and functions need JSDoc explaining _why_ they exist.

- `@param` MUST NOT include TypeScript types.
- `@throws {ExceptionType}` in curly braces.
- No `@returns` on `void`/`Promise<void>` methods.
- Decorator functions returning a decorator: describe the value, not the raw type.

## Testing Rules

- `vitest.config.mts` has `restoreMocks: true` — never call `vi.clearAllMocks()`, `vi.resetAllMocks()`, or `vi.restoreAllMocks()` manually.
- Never assert hardcoded validation message strings — use `expect.any(String)` or `expect.stringContaining(...)`.
- **Positive & Negative Path**: verify all mocks called in chronological order with `.toHaveBeenCalledWith(...)`. In negative paths, only assert `.not.toHaveBeenCalled()` on the **immediate next** function — not further downstream.

## What NOT to Do

- Do not import Drizzle, NestJS decorators, or HTTP types inside `domain/` or `application/`.
- Do not perform DB queries across module boundaries — go through the Facade.
- Do not use `any` — ESLint enforces `@typescript-eslint/no-explicit-any`.
- Do not access `process.env` directly anywhere except `env.validation.config.ts`.
- Do not skip `class-validator` decorators on any DTO property.
- Do not store state or uploaded files in local memory or local filesystem.

## Directory Structure

```
src/
  core/                         # NestJS framework wiring only — no business logic
    cache/
    config/
    database/
    email/
    exception/
    interceptor/
    logger/
    outbox/
    script/
    security/
    throttle/
  modules/                      # Bounded Contexts
    <module>/
      application/
        command/                # Command handlers
        query/
          read-model/           # Plain interfaces — no runtime cost
        port/                   # *-query.port.ts (exception to domain/constant rule)
        constant/               # All injection token Symbols
      domain/
        aggregate/
        enum/
        event/
        repository/             # Port interfaces
      infrastructure/
        database/
          schema/               # Module-owned Drizzle schema
        repository/             # Write + query repository implementations
      presentation/
        controller/
        dto/
        listener/               # Domain Event subscribers
        decorator/
      <module>.facade.ts        # Public API for other modules
      <module>.module.ts
  shared/                           # Cross-module building blocks (MUST NOT depend on src/core/)
    domain/                         # Pure TS — Base Aggregate Root, Base Domain Event, Base VO, base domain exceptions
      auth/                         #   AuthUserRole, AuthTokenType enums; IAuthIdentity interface
      exception/                    #   Domain exception classes + error type enums
    application/                    # Shared DTOs, Port interfaces + injection tokens
      port/                         #   cache, database, email, logger, security (incl. token payload interfaces)
      pagination/                   #   QueryPaginationDto, ResponsePaginationDto
      search/                       #   QuerySearchDto
      config/                       #   ENV constant
      routing/                      #   API version constant
      util/                         #   shared utilities
    infrastructure/                 # Base Drizzle schema (id, createdAt, updatedAt)
      database/
    presentation/                   # NestJS / HTTP artifacts only
      auth/                         #   AuthGuard, AuthRolesGuard, @Public(), @Roles(), @AccessTokenPayload()
      doc/                          #   ApiDefault* Swagger decorators, Swagger config
      exception/                    #   ErrorDefaultDto
      throttle/                     #   @CriticalThrottle()
      validation/                   #   @Email(), @Password(), ParamIdDto, NotEmptyBodyPipe
test/                           # E2E and integration tests
.agents/
  rules/
    nestjs-skeleton.md          # Mirror of CLAUDE.md — always kept in sync
```

## Commands

| Task                  | Command                                 |
| --------------------- | --------------------------------------- |
| Dev server            | `npm run start:dev`                     |
| Production            | `npm run start:prod`                    |
| Unit tests            | `npm run test`                          |
| Unit tests (watch)    | `npm run test:watch`                    |
| E2E tests             | `npm run test:e2e`                      |
| Type check            | `npm run test:type`                     |
| Lint                  | `npm run lint`                          |
| Lint + fix            | `npm run lint:fix`                      |
| Format                | `npm run format`                        |
| DB generate migration | `npm run db:generate`                   |
| DB run migration      | `npm run db:migrate`                    |
| DB studio             | `npm run db:studio`                     |
| Docker dev up         | `npm run docker:dev:up`                 |
| Docker dev down       | `npm run docker:dev:down`               |
| Build Swagger JSON    | `npm run build:swagger`                 |
| Seed super-admin      | `ts-node src/core/script/seed-admin.ts` |

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
