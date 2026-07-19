# NestJS Modular Monolith — Claude Guide

## Project Purpose

Production-ready NestJS backend — strict DDD, Hexagonal Architecture, horizontal scalability, Lift-and-Shift microservice readiness.

This repo is a **reference skeleton**, and that goal outranks convenience on every decision:

- **Copy-paste startable.** Clonable as the starting point of a new project with no unpicking: nothing hard-codes this project's identity, and no half-built feature is left for the next user to discover.
- **Microservice extraction must stay cheap.** Every boundary is drawn so a bounded context can be lifted out without rewriting it.
- **The bar is architectural correctness, not "it works."** Top-tier engineering practice, security, and standards compliance win over the shorter path.

## AI Behavior

- **When a request conflicts with this guide, say so and correct it** instead of complying.
- **Never run tests, lint, or format automatically** — the user runs them.
- **Do not auto-generate spec/test files** — the user owns tests; generate one **only** when explicitly asked.
- **Keep this file lean when maintaining it.** State each rule once, in its owning section, with at most one example and a one-sentence rationale; cross-reference (`§`) instead of repeating; leave enforcement mechanics to `eslint.config.mjs`'s comments. Shorten presentation freely, but never weaken a rule's meaning to save words.

## Architecture

### 1. Layer Isolation (Dependency Rule)

Dependencies flow strictly inward. Every other import is ILLEGAL.

**`eslint.config.mjs` is the authority, not this table.** Enforced by `eslint-plugin-boundaries` (`boundaries/dependencies` with `default: 'disallow'`, plus `boundaries/no-unknown`). Never work around a boundary error — it means the design is wrong, not the config. If a rule genuinely must change, change `eslint.config.mjs` and mirror it here.

| Element                               | May import from                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `shared`                              | `shared`                                                                                                                      |
| `core`                                | `shared`, `core`                                                                                                              |
| `domain` (`module/*/domain`)          | `shared`, own module's `domain`                                                                                               |
| `application`                         | `shared`, `core`, own module's `domain` + `application`                                                                       |
| `infrastructure`                      | `shared`, `core`, own module's `domain` + `application` + `infrastructure`, any module `index.ts`                             |
| `presentation`                        | `shared`, `core`, own module's `application` + `presentation`                                                                 |
| `*.facade.ts`                         | own module's `application` ONLY                                                                                               |
| `module/*/index.ts`                   | own `facade` + own `*.module.ts` ONLY                                                                                         |
| `*.module.ts`                         | own module's `presentation` + `application` + `infrastructure` + own `facade`, plus any module `index.ts` / `core` / `shared` |
| `src/instrument.ts`, `src/tracing.ts` | `shared`, `core` ONLY                                                                                                         |

What the table alone does not say:

- **`domain` AND `shared` are pure TypeScript** — no npm package at all (Node builtins stay legal). `shared` is held to the same bar because `domain` imports it: a package admitted there would reach `domain` transitively. Lint denies both layers every `origin: 'external'` dependency, so a new package is refused by default.
- **A module's `application/` depends on core's contract surface** (ports, exceptions, types, utils) — never on a core adapter; adapters arrive by DI.
- **`{{from.captured.module}}` means "own module"**, so cross-module traffic is legal only into a module `index.ts`, and only from `infrastructure` or `*.module.ts`. A `*.module.ts` may also reach its OWN `facade` — that is wiring inside the context, not a crossing.
- **Every file must belong to an element** (`boundaries/no-unknown-files`). This is what makes "no fourth pillar" enforceable: a file under no layer is rejected rather than living outside every rule.
- **`src/main.ts` and `src/app.module.ts` are the only exempt files** (`boundaries/ignore`): composition roots must see everything, and `boundaries/no-ignored` bans importing them back. `src/instrument.ts`/`src/tracing.ts` are NOT exempt — a `bootstrap` element restricted to `shared` + `core`: starting Sentry/OTel never reads into a module.
- **Relative imports are banned** (`no-restricted-imports`). Always absolute from `src/` or `test/`.
- **Cycles inside one layer are caught by `import/no-cycle`** — `boundaries` only constrains direction BETWEEN layers, and `forwardRef()` is prohibited (§2), so this rule is the only net for intra-layer cycles.
- **devDependencies must not be imported from `src/`** (`import/no-extraneous-dependencies`) — they die at container start under `npm ci --omit=dev`. Co-located `*.spec.ts` files are the sole exemption.
- **Boundary rules cover `src/` only.** `test/` is deliberately outside them for now — see § Testing Rules.

### 2. Module Isolation & the Facade

- **The Facade is the single door into a bounded context, and that door is reached through `module/<ctx>/index.ts`** — never by importing `<ctx>.facade.ts` directly: a barrel that can be bypassed closes nothing (§ Barrels). Sole exception: the context's own `*.module.ts`, which provides and exports the facade.
- A Facade exposes **READ/Query only**, or pre-transaction validation. Anything that must trigger a mutation elsewhere goes async (§5).
- It MUST return the **query's own flat result type** — the `type` declared in that query's `query.ts` (e.g. `get-user-auth-state/query.ts` → `GetUserAuthStateResult`). Never a Drizzle object, an Aggregate Root, or a presentation `*.dto.ts` class.
- `forwardRef()` is **PROHIBITED** — resolve circular deps via EDA (§5).

### 3. CQRS Discipline

- **Commands**: mutate state, return only the affected entity's `id` (or `void`). The Aggregate mutates itself; hand the whole Aggregate to its port. **Exception**: auth token-generation commands (login, refresh) may return `{ accessToken; refreshToken }` — ephemeral tokens that cannot be re-queried.
- **Queries**: NEVER mutate. Read through the **query port** (reader adapter) into its result type.
- **Read-models** — a query's result `type` — are co-located in its `query.ts`. A controller dispatching a query MUST annotate its return type with that type, imported from the query folder and never from `domain/`.
- **Read transport — QueryBus vs. direct port**: use the **QueryBus** only when crossing _into_ the read side from outside — a **controller**, or a **Facade** exposing a cross-module read. Code already in the application layer (event subscriber, cron, command handler) MUST `@Inject(TOKEN)` the **query port directly** — a QueryBus hop there hides the dependency graph. **Folder consequence**: `handler.ts` present = QueryBus-dispatched, absent = port-invoked; the result type always stays in `query.ts`, the contract in `port.ts`.
- **Every query owns a thin outbound port (ISP).** The handler depends on **one purpose-specific port** exposing only its read — never a broad/foreign port (a health-summary handler must not inject the full cache/database ports for a liveness flag). A read **composed from other ports** is composed in the port's **adapter**, never the handler — true even for pure forwarding+merging, because the value is the narrowed contract. (Cardinality: see **Adapters**.)

### 4. Data & State Boundaries

- **Schema-per-module**: each module owns its Drizzle schema in a PostgreSQL logical schema named after the bounded context (e.g. `user.user`). No central registry; only the owner reads/writes its tables.
- **No cross-module JOINs.** Merge multi-module data in RAM via Facade calls (API Composition).
- **Soft links only**: store the UUID as a plain string column — no FK constraints.
- **No synchronous cross-module transaction.** Cross-module state is reconciled asynchronously (§5).
- **Stateless**: never store session data in local memory — use Redis.

### 5. Events & Messaging

Async Domain Events are required when a mutation must trigger reactions in other modules.

- **Publish through `IEventBusPort`** (`TOKEN_EVENT_BUS_PORT`) — never inject `EventEmitter2` directly; the port keeps the transport swappable when the outbox lands. Lint bans the `EventEmitter2` import everywhere except `src/core/event-bus/`; `@OnEvent` and `EventEmitterModule` stay legal — the subscribe and wiring sides have no port to route through.
- **Events carry ONLY minimal metadata** — typically `type` + `aggregateId`. Never the full payload.
- **Never trust event data as current** — re-read from DB or Facade when the handler runs.
- **Listeners stay idempotent**, because at-least-once delivery is the destination.
- **Where a listener lives is decided by where the event was EMITTED — never by what the listener does.**
    - **Emitted by our own application, handled in-process** → that module's `application/event/`; nothing crossed a process boundary.
    - **Emitted by another source, arriving over the network** (Postgres `LISTEN/NOTIFY`, a broker topic, an inbound webhook) → `presentation/listener/` — an inbound adapter exactly like a controller: it terminates a transport.

#### Reliable messaging — NOT YET IMPLEMENTED

**Delivery is UNRELIABLE and that is a known, accepted gap.** Events are emitted in-process via `IEventBusPort.emitAsync` (`@nestjs/event-emitter`). There is no outbox table, no relay, no queue, no broker — an event is lost if the process dies after the DB commit, and a listener failure never retries.

- **Do not pretend otherwise.** Never write code, comments, or docs implying at-least-once delivery, retries, or transactional atomicity between a DB write and an event.
- **Do not invent the outbox piecemeal.** No ad-hoc `outbox` table, dedup ledger, relay cron, or queue module until the pattern is designed as a whole — a half-built outbox looks reliable and isn't.
- **Weigh this when designing.** If a flow cannot tolerate a lost event, raise it rather than silently shipping it over `emitAsync`.
- **Planned (not present):** transactional outbox — critical events INSERTed into `outbox` in the same SQL transaction as the entity write, drained by a relay worker onto a queue; consumers idempotent; status updated, never deleted; an inbox for effects that are harmful to repeat.

### 6. Dependency Injection

Always use NestJS Custom Providers (TS interfaces are erased at runtime):

1. Define the Symbol token in the same file as its port interface.
2. Inject with `@Inject(TOKEN_NAME)` in `application/`.
3. Bind with `{ provide: TOKEN_NAME, useClass: SomeAdapter }` in the module — several tokens may bind to the same adapter class.

## Project Structure

Three top-level pillars, each with one job — and no fourth may be added:

- **`src/shared/`** — pure, framework-free primitives any layer may use.
- **`src/core/`** — the platform kernel: cross-cutting technical concerns as port + adapter + NestJS wiring. No business rules, no domain entities.
- **`src/module/`** — the bounded contexts.

**Adding a folder under `core/` or `shared/` is a two-file change: the folder AND a `boundaries/elements` entry in `eslint.config.mjs`.** Which form the entry takes is the shelf-vs-concern decision — see § Barrels.

Group by bounded-context → hexagonal layer → role.

```
src/
  main.ts                     # composition root — exempt from boundary rules
  app.module.ts               # composition root — exempt from boundary rules
  instrument.ts               # Sentry bootstrap  — `bootstrap` element, may reach shared + core only
  tracing.ts                  # OTel bootstrap    — `bootstrap` element, may reach shared + core only
  shared/
    domain/                   # SHELF (no index.ts): admin/  user/  event/  aggregate-root/
    application/              # SHELF (no index.ts): event/
    exception/  pagination/  search/
  core/
    cache/  config/  database/  doc/  email/
    event-bus/  exception/  http/
    observability/            # SHELF (no index.ts): logger/  tracker/
    security/                 # SHELF (no index.ts): auth/  hashing/  session/  throttle/  token/
  module/
    <module>/
      index.ts
      <module>.module.ts
      <module>.facade.ts
      application/
        command/
          port/               # write port(s) shared across commands
          <command-name>/     # command.ts + handler.ts (+ port.ts)
        query/
          <query-name>/       # query.ts + port.ts (+ handler.ts)
        event/
        cron/
      domain/
        aggregate/
        event/                # domain-event enums
      infrastructure/
        adapter/
        <module>.schema.ts
      presentation/
        controller/
        dto/
        listener/
        decorator/            # module-specific (e.g. auth)
test/                         # E2E and integration tests
```

**Core principle: things that change together live together. The grouping axis is the CONCEPT — never a TypeScript keyword.** Everything below follows from this.

### 1. Placement — ask in order, stop at the first "yes"

1. **Does it belong to exactly one contract?** (a port's payload, an exception's message vocabulary) → put it INSIDE that contract's file. They change together; splitting them forces edits in two places.
2. **Does it have an owner?** (who would _change_ it — not who _uses_ it) → put it next to the owner; others import from there.
3. **Is it genuinely shared vocabulary?** → one descriptively named file at the concept's root. But check first: if changing it for one consumer would break the other, that is coupling, not sharing — merge the concepts or duplicate the shape.
4. **None of the above?** → the concept boundary is wrong. Split the concept, not the file.

### 2. Folders — decided up front by the role's nature, never by file count

The test is NOT "how many files exist now" but **"can this role ever have more than one member?"** If yes, the structure is built for the plural case from the first file — nothing is ever promoted, no path ever churns.

- **Plural roles — own folder from the first file**: `adapter`, `port`, `command`, `query`, `listener`, `cron`, `event`, `controller`, `dto`, `decorator`, `guard`, `filter`, `interceptor`, `pipe`.
- **Singular roles — stay flat, never get a folder**: `module`, `facade`, `schema`. One per concept by definition; a folder here is an empty box. **No wrapper folder either** — the schema is `infrastructure/<module>.schema.ts`, never `infrastructure/database/<module>.schema.ts`: a data source is an axis carried by the **filename** (`user-cache-reader.adapter.ts`), never by a folder.
- **Growth axis is the sub-concept, never the kind.** A concept accreting a large type family is the signal to split it into sub-concepts (`email/` → `sending/`, `ledger/`, `queue/`, each carrying its own types/enums/ports) — the swelling means the concept does too much. If you cannot name the result, either the split isn't needed or the result is a bag with no identity.

### 3. Naming

- **Everything is singular** — folders (`dto/`, `adapter/`) and files (`user.controller.ts`), never plural.
- **Role suffix, dot-separated**: `emailer.port.ts`, `user.schema.ts`, `admin.facade.ts`. Never a hyphen — `email-type.ts` reads as "a thing called EmailType"; `email.type.ts` reads as "email, a type file". Two separators in one folder is noise.
- **KIND is never a folder and never a filename** — `type`, `enum`, `constant`, `util`, `interface`, `class`, `payload`, `common`, `shared`, `helper`, `misc`. A kind names a language keyword, not content: it separates things that change together and collocates things that don't. Never correct, at any size. **The test**: can you name the file after its content without the words "type"/"constant"/"enum"? If not, the **Placement** questions were skipped. (The three pillars are not kind folders; the ban targets folders opened _inside_ a concept, and nothing below the pillars may reuse their names.)
- **Bare ROLE names** (`port.ts`, `adapter.ts`, `handler.ts`, `command.ts`, `query.ts`, `module.ts`) depend entirely on the parent folder:
    - **Inside a CONCEPT folder → required.** `command/create-user/command.ts`, `.../handler.ts`, `.../port.ts`. The folder names a concept and holds exactly one file per role, so it fully supplies identity; re-stating it (`create-user.command.ts`) is stutter.
    - **Inside a KIND or ROLE folder → forbidden.** `adapter/adapter.ts`, `command/port/port.ts` read only because of the folder, so they die on move (identical tabs, indistinguishable stack traces) — use the role suffix: `user-reader.adapter.ts`, `user-writer.port.ts`.

### 4. Barrels — a barrel is a BOUNDARY, not an alias

The only test: _does an outsider import from here, and are the inner files off-limits to them?_

- **Yes → add the barrel, and then NOBODY may deep-import past it.** A barrel used alongside deep imports into the same folder closes nothing.
- **No → do not add one.** A barrel nobody imports from is zero benefit and one more file to maintain.

| Level                                                    | Barrel? | Why                                                                                                                   |
| -------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| Bounded context (`module/<ctx>/`)                        | YES     | A real boundary. Exposes ONLY the Facade + Module.                                                                    |
| Core/shared concern — the independently consumed one     | YES     | The concept's public API. Consumers enter only here.                                                                  |
| A parent that merely SHELVES concerns (`core/security/`) | NO      | Not a concept — a bag of them, same mistake as a layer barrel.                                                        |
| Hexagonal layer (`application/`, `presentation/`)        | NO      | Not a concept — a bag of them. Broad, cycle-prone surface.                                                            |
| Role folder (`adapter/`, `port/`, `dto/`)                | NO      | Not a boundary, just an alias — the classic cause of circular deps in layered DDD, and it hides the dependency graph. |
| Concept folder (`command/<name>/`)                       | NO      | Not a boundary — an alias.                                                                                            |

**In `core/` AND `shared/`, "concern" is not a fixed depth — it is whatever outsiders consume as ONE thing.** The barrel goes on the **deepest node imported as a whole**; every folder above it is a shelf with no `index.ts`. `core/cache/` and `shared/pagination/` are each consumed as one capability → barrel on them. `core/security/` and `shared/domain/` shelve capabilities consumed separately by unrelated callers → the barrels sit on the capabilities, and **`core/security/index.ts` / `shared/domain/index.ts` must not exist**. Consequently `index.ts` exists in exactly three kinds of place — `module/<ctx>/`, a core concern, a shared concern — and stacked nested barrels are impossible: if two levels both look right, the parent is a shelf.

**Machine-enforced** by `boundaries/dependencies`: every `core`/`shared` concern is an element in `eslint.config.mjs`, and a trailing rule makes its `index.ts` the only legal entry point. Shelves are never declared — a shelf entry takes a trailing `/*`, a concern none; the forms, their failure modes, and the rule ordering are documented in the config's own comments, and `test/architecture/boundaries-element.spec.ts` verifies each entry's form against whether `index.ts` exists on disk.

**NEVER use a barrel as a design justification.** "It goes through `index.ts` anyway" would equally defend one 5000-line file; a barrel only flattens the CONSUMER's view, and organization is for the person opening the file to change it.

### 5. Adapters — the seam is "what changes together", not a project-wide label

Do NOT impose one uniform adapter split everywhere. Ask per concern: **do the read and write sides change for different reasons and depend on different things?**

- **Inside a module: YES → split reader / writer.** This is CQRS projected onto the infrastructure layer. The writer injects the DB + event bus + logger, takes the Aggregate, and `implements` exactly one write port; the reader injects the data source only, returns read-models, and accretes an `implements` clause per query. They change at different rates, so they must not share a class.
- **Inside `core/`: NO → split by CAPABILITY instead** (`cache` / `cache-health` / `cache-cleaner`). A technical capability's get and set change for the same reason, over the same connection — `CacheReaderAdapter`/`CacheWriterAdapter` would be pure ceremony, and some concerns have no read side at all (`IEmailerPort.sendEmail`). If a core concern's read and write sides genuinely diverge, split the **concern** into sub-concepts, not the adapter.
- **Adapter count = data source × (read/write).** A module reading from a second source (e.g. cache) gets its own reader for THAT source — the axis is the source, not read/write. Never bolt a second data source onto an existing reader.
- **One reader per data source implements every thin read-port of that source** (`AdminReaderAdapter` — one `*-reader.adapter.ts`, injecting the data source once), never one adapter per port; handlers still see only their thin port.
- **Readers consolidate, writers are singular, and a module that never writes has no writer** — do not open an empty box.
- **Writers own driver-error translation.** A constraint violation is meaningful only to the schema's owner, so the writer catches the driver error at the port boundary and rethrows the matching taxonomy exception with `{ cause }` (unique-violation on `email` → `ResourceConflictException(EMAIL_IN_USE)`). Classification predicates live in `core/database` (`isUniqueViolation`); a raw driver error never escapes infrastructure — anything unclassified surfaces as 500 + Sentry, correct for an unexpected constraint.

## HTTP Layer

### DTOs

| Type         | Prefix      | Example                                          |
| ------------ | ----------- | ------------------------------------------------ |
| Request body | HTTP method | `post-user.dto.ts` → `PostUserDto`               |
| Query params | `query-`    | `query-pagination.dto.ts` → `QueryPaginationDto` |
| Response     | `response-` | `response-user.dto.ts` → `ResponseUserDto`       |
| Error        | `error-`    | `error-default.dto.ts` → `ErrorDefaultDto`       |

**Class-level:**

- `@ApiSchema({ name, description })` on EVERY DTO. `name` is the class name without `Dto` (`PostUserDto` → `'PostUser'`); `description` is a real sentence explaining what the schema is for — never omitted, never a restatement of the name.
- JSDoc above the class explaining _why_ it exists (what it enforces or guarantees).
- **Response DTOs**: `@Exclude()` at class level + `@Expose()` on every property. This is a whitelist — anything not `@Expose()`d must never reach a client.

**Per property — the first three always, the fourth on response DTOs:**

1. **JSDoc** describing the field's meaning.
2. **Validation + documentation, in this order of preference:**
    - **A composed decorator from `src/core/http/validation/decorator/` if one fits** (`IsUserEmail`, `IsStrongPassword`, `IsEntityId`, …) — checking that folder first is MANDATORY: the decorator bundles `class-validator` rules AND `@ApiProperty` in one call, keeping each limit defined in exactly one place. Pass the field-label prefix (`@IsUserEmail('The email address')`) — it feeds both the Swagger description and the error messages.
    - **Otherwise, raw `class-validator` rules + an explicit `@ApiProperty`** — the correct outcome for a genuinely one-off field.
    - **Exception — response DTOs never carry raw `class-validator` rules.** Nothing validates an outgoing body at runtime, so a validator there is dead code posing as a guarantee; `@ApiProperty` alone must express every constraint (`minimum`/`maximum`, `minLength`/`maxLength`, `minItems`, `enum`) the field's contract implies. A composed decorator on a response DTO stays — it is the single source of that field's `@ApiProperty` metadata.
3. **`readonly`** — always. **Required** field: definite assignment, `readonly email!: string`. **Optional** field: `?` plus `@IsOptional()`, `readonly search?: string`. `!` and `?` are mutually exclusive in TypeScript, so an optional property NEVER carries `!`.
4. On response DTOs, `@Expose()` as well.

**A shape earns a composed decorator on its SECOND use, never the first.** The decorator folder holds shared field vocabulary, so a single-use decorator must never be added there. When a second field needs the same shape, promote the raw stack into a composed decorator and migrate both call sites — from then on the limits live in exactly one place.

**Never leave a property undecorated** — DTO validation is the trust boundary, so such a field is both unvalidated input and undocumented output. None of the above is optional where it applies: a DTO that falls short is incomplete work, not a draft.

### Guards & Auth

- `AuthGuard` (JWT) and `AuthRolesGuard` (roles) are global. Mark public endpoints with `@Public()`.
- Use `@CriticalThrottle()` on sensitive endpoints (login, refresh).

### Responses & Errors

- `ResponseInterceptor` wraps all responses — do not wrap manually.
- Throw the exception taxonomy classes from `src/shared/exception` (subclasses of `AppException`, e.g. `ResourceNotFoundException`) — never NestJS HTTP exceptions. Ownership from throw to HTTP response: § Exception Responsibility below.
- Use `QueryPaginationDto` for pagination input, `ResponsePaginationDto` for output.

#### Exception Responsibility

Who owns what, from throw to HTTP response — each concern lives in exactly one place:

- **`src/shared/exception` owns the taxonomy.** Abstract `AppException` (transport-neutral `ExceptionKind` + `AppExceptionOptions`) and its subclasses, each co-locating its `*Message` enum in the same file (§ Placement rule 1). The taxonomy knows no HTTP, no framework.
- **Message vocabulary follows the thrower.** A shared `*Message` enum holds only messages generic to the kind (`DEFAULT`, `EMAIL_IN_USE`); a use case's own rejection messages live in its `command.ts` (e.g. `RefreshTokensMessage.CONCURRENT_REFRESH`); a single-thrower message is inlined at the throw site (§ Variable Inlining); a core-owned thrower keeps its vocabulary in its own concern (`RateLimitMessage` in `core/security/throttle`). Never grow a shared enum for one module's need — every `ApiDefault*` doc decorator takes `message: string` defaulting to the shared `DEFAULT`, never an enum type, so core never learns a module's vocabulary.
- **HTTP request-validation vocabulary is not taxonomy vocabulary.** `RequestValidationMessage` (`PAYLOAD` / `PARAM`) lives in `core/http` because the effective thrower is Nest's `ValidationPipe`, not `InvalidInputException`; `InvalidInputMessage` carries only the vocabulary of code that genuinely throws that exception. Follow the thrower, not the status code the two happen to share.
- **Throwers throw; they do not log.** Raise `new ...Exception(message, { context })` and nothing else — whether and how the failure is logged is the filter's decision alone. `context` is `{ class: string; method: string; [key: string]: unknown }`: only the origin is typed, the rest free-form so `shared` never learns a module's vocabulary; `cause` is reserved for the underlying error. Attaching `context` signals "this rejection was deliberate and I have detail on it". Context vocabulary follows the thrower too: no key may come from a consumer of the log (e.g. a logger enum). Rejection vocabulary shared by several commands of one module lives in one descriptively named file at that module's `application/command/` root; the filter records it as opaque data. On `@Public()` routes the thrower's `sub`/`role` in context are the audit log's only identity source — the guard never ran there.
- **Aggregates own their invariants; the throw-or-no-op test is the requested END STATE.** End state already holds (`ban()` on a banned account) → silent idempotent no-op, no event — re-emitting would lie. Transition would break an owned invariant → the aggregate throws the taxonomy exception itself (`domain` may import `shared`); never trust callers to pre-check. Pick the kind by who can trigger it: client-reachable rejection → matching client-facing kind (`InvalidInputException`, `ResourceConflictException`); state unreachable through normal flows → `SystemException`, because 500 + Sentry is the intended outcome for a broken code path. Current instance: **a soft-deleted aggregate is immutable** — `SoftDeletableAggregateRoot` (`shared/domain/aggregate-root`) owns it, and every mutator except `markAsDeleted` calls its `assertNotDeleted` (throws `SystemException` with `context`), since writers' `load()` filters `deletedAt IS NULL` and only a bug can hand a deleted aggregate to a mutator. **An invariant shared by several aggregates is hoisted to an opt-in base class, never onto `AggregateRoot`** — a universal base would force every future aggregate to be soft-deletable.
- **The global filter (`src/core/exception`) is the only place the taxonomy meets HTTP.** It maps kind→status via the exhaustive `KIND_TO_STATUS` Record (a new kind without a status fails compilation), renders `ErrorDefaultDto`, and owns all exception logging, decided in this order: `503` silent per request (outage detection is the health alarm's job, § Observability); `>=500` → error log + Sentry, checked FIRST so a context-carrying `SystemException` cannot degrade to a `warn`; then `403`/`429` and a context-carrying `401` are stamped `SECURITY_EXCEPTION`, any other context-carrying rejection gets a plain `warn`, and a rejection with no context and no security status stays silent. Only genuinely security-relevant statuses earn the action, so filtering the audit trail by it never surfaces noise. `context` is carried verbatim under its own key — never merged, never read.
- **Infrastructure translates; nothing leaks** — writers rethrow driver errors as taxonomy exceptions at the port boundary (§ Adapters — "Writers own driver-error translation"); an untranslated infrastructure error surfacing as a generic 500 + Sentry is the correct outcome for the unexpected, never a formatting gap to patch in the filter.

### API Documentation

**Documentation first**: every controller endpoint needs `@ApiTags`, `@ApiOperation`, and `ApiDefault*` decorators. Before adding a raw `@ApiResponse`, check `src/core/doc/decorator/` for an existing `ApiDefault*`.

**A status's description must cover EVERY reason that endpoint can return it.** Swagger allows one description per status, so the choice is decided by how many rejections share the code, never by which one comes to mind first:

- **One deliberate cause** → pass that message: `@ApiDefaultResourceConflictResponse(ResourceConflictMessage.EMAIL_IN_USE)`.
- **Several causes** → pass nothing; the generic `DEFAULT` is correct — naming one of five reasons documents the endpoint as if the other four did not exist.

Never invent a per-endpoint message enum to enumerate causes — the client branches on the status code, and the body already carries the specific message at runtime.

## Observability (Logging & Exception Tracking)

Decide per catch/branch by asking **"who acts on this, and does the system fix itself?"** — never log or capture reflexively.

- **Sentry (`IExceptionTrackerPort.captureException`) → only when a human must intervene and it will NOT self-heal.**
- **`logger.warn` → self-healing failure whose _cause_ is a forensic breadcrumb.** It answers _why_, doesn't alert. Justified only when both hold: (1) something else — a metric or an existing Sentry alert — already detects the incident and brings someone to the logs, (2) the warn carries a root cause not available elsewhere.
- **`logger.log` → operationally significant events** possibly needed later for audit/forensics even without failure (e.g. login/auth-state change). Meaningful state transitions, not routine chatter.
- **Silent `catch` → fully self-healing failure nobody will investigate.** Swallow with an explanatory comment; no log, no Sentry. E.g. shutdown-cleanup errors (the OS reclaims the socket). The `catch` only stops an unhandled rejection.
- **A self-healing `catch` must not throw.**

### Dependency outages — one record per episode, never per request

A downed dependency (Redis, Postgres) fails every call until it recovers, so the choice is not _whether_ the cause is worth a breadcrumb but _where_ it is recorded. **The breadcrumb belongs at the CONNECTION level, gated on a state-transition flag; every per-call and per-request failure path stays silent.**

- **The transition site logs** — a `warn` with the driver error and `ConnectionLogMessage.LOST` on the way down, a `log` with `RESTORED` on the way back — once per episode, guarded by an `isDown` flag. The site depends on the driver: ioredis exposes connection events (`core/cache/module.ts`); postgres.js does not, so the periodic health probe is the transition site (`core/database/adapter/database-health.adapter.ts`).
- **Everything downstream is silent** — fail-open cache/throttle reads, best-effort session writes, the global filter's `503`. Detection is the health alarm's job and the cause is already named once; per-call records flood exactly when the logs matter most.
- **`ConnectionLogMessage` is shared vocabulary on purpose** (`core/observability/logger`) — an outage reads identically across dependencies, so the two transitions are greppable as one thing.

## Coding Conventions

### JSDoc

Every file MUST start with `@file` + `@description`, and `@file` MUST match the filename — a stale `@file` makes the file lie about itself and misleads search and review. All classes, interfaces, methods, and functions need JSDoc explaining _why_ they exist.

- `@param` MUST NOT include TypeScript types.
- `@throws {ExceptionType}` in curly braces.
- No `@returns` on `void`/`Promise<void>` methods.
- Decorator functions returning a decorator: describe the value, not the raw type.

### `interface` vs `type`

- **`interface`** — a **contract or behavior** a class will `implement`: Ports, Repositories, Service contracts.
- **`type`** — a pure **data shape** with no behavior: Command/Query payloads, results, read-models, unions/intersections, utility compositions (`Pick`, `Omit`, `Partial`), tuples.

Rule: "What does it **do**?" → `interface`. "What does it **contain**?" → `type`.

### Return Types

- **Interfaces**: always annotate explicitly (including `void`/`Promise<void>`).
- **Class implementations**: do NOT annotate `void`/`Promise<void>`; DO annotate all non-void returns.

### Environment Variables

Never use `process.env` directly — always `ConfigService` with the `ENV` constant:

```ts
configService.getOrThrow<string>(ENV.JWT_ACCESS_SECRET);
```

### Route & Prefix Literals

Any route fragment visible from more than one place is a constant in `core/config` — `GLOBAL_PREFIX`, `ROUTE_HEALTH`, and the `PATH_HEALTH` derived from them — never a string literal repeated at each site.

A module's route segment living in `core/` is a deliberate, narrow concession: the global filter must recognize the exact health path to let its intentional `503` through unnormalized, and `core` may not import a module. The constant stops the filter and the controller drifting apart silently on a rename.

### Variable Inlining

Used once → inline. Used more than once → extract to a named variable.

## Testing Rules

- `vitest.config.mts` sets `restoreMocks: true` — never call `vi.clearAllMocks()` / `vi.resetAllMocks()` / `vi.restoreAllMocks()`.
- Never assert hardcoded validation message strings — use `expect.any(String)` or `expect.stringContaining(...)`.
- **Positive & Negative Path**: verify all mocks called in chronological order with `.toHaveBeenCalledWith(...)`. In negative paths, assert `.not.toHaveBeenCalled()` only on the **immediate next** function — not further downstream.

**`test/` import rules** — TODO, still to be designed. `test/` is no element, so `boundaries` does not constrain it: a test may import a module's writer adapter directly and lint stays green. Remind the user this is open whenever test structure or a test's imports come up. Likely shape: `test/api/**` restricted to `module/<ctx>/index.ts` + `presentation` (E2E drives over HTTP), plus a looser element for integration tests — not decided.

## Reference

### Commands

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

### Tech Stack

| Concern            | Technology                                                    |
| ------------------ | ------------------------------------------------------------- |
| Framework          | NestJS v11+ with SWC builder                                  |
| HTTP               | Fastify (`@nestjs/platform-fastify`)                          |
| Database           | Drizzle ORM + PostgreSQL (`postgres` client)                  |
| Cache / Rate Limit | Redis (`ioredis`, `@nest-lab/throttler-storage-redis`)        |
| Events             | `@nestjs/event-emitter` — in-process, behind `IEventBusPort`  |
| Queue              | none yet — see **Events & Messaging**                         |
| Email              | Google APIs (Gmail)                                           |
| Hashing            | Argon2                                                        |
| Validation         | `class-validator` + `class-transformer`                       |
| Observability      | Sentry, Pino, OpenTelemetry, Prometheus, Jaeger, Grafana Loki |
| Testing            | Vitest, Supertest, Spectral, Schemathesis                     |
