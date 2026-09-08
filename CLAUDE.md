# NestJS Modular Monolith — Claude Guide

## Project Purpose

Production-ready NestJS backend — strict DDD, Hexagonal Architecture, horizontal scalability, Lift-and-Shift microservice readiness.

This repo is a **reference skeleton**, and that goal outranks convenience on every decision:

- **Copy-paste startable.** Clonable with no unpicking: nothing hard-codes this project's identity, no half-built feature is left behind.
- **Microservice extraction stays cheap.** Every boundary is drawn so a bounded context lifts out without a rewrite.
- **The bar is architectural correctness, not "it works."** Top-tier engineering, security, and standards compliance beat the shorter path.

## AI Behavior

- **When a request conflicts with this guide, say so and correct it** instead of complying.
- **Never run tests, lint, or format** — the user runs them.
- **Never auto-generate spec/test files** — the user owns tests; write one **only** when explicitly asked.
- **Keep this file lean when maintaining it.** Each rule once, in its owning section, with at most one example and a one-sentence rationale; cross-reference (`§`) instead of repeating; leave enforcement mechanics to `eslint.config.mjs`'s comments. Shorten presentation freely, never a rule's meaning.

## Architecture

### 1. Layer Isolation (Dependency Rule)

Dependencies flow strictly inward. Every other import is ILLEGAL.

**`eslint.config.mjs` is the authority, not this table**, and it carries the enforcement mechanics in its own comments — **read it before creating, renaming or moving any file or folder**. Never work around a boundary error: it means the design is wrong, not the config. To change a rule, change `eslint.config.mjs` and mirror it here.

| Element                                         | May import from                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `shared`                                        | `shared`                                                                                                                      |
| `core`                                          | `shared`, `core` — NOT `coreCqrs`                                                                                             |
| `coreCqrs` (`core/cqrs`)                        | `shared`, `core`                                                                                                              |
| `domain` (`module/*/domain`)                    | `shared`, own `domain`                                                                                                        |
| `application`                                   | `shared`, `core`, `coreCqrs`, own `domain` + `application`                                                                    |
| `infrastructure`                                | `shared`, `core`, own `domain` + `application` + `infrastructure`, any module `index.ts`                                      |
| `presentation`                                  | `shared`, `core`, `coreCqrs`, own `application` + `presentation`                                                              |
| `*.facade.ts`                                   | `coreCqrs` + own `application` ONLY                                                                                           |
| `module/*/index.ts`                             | own `facade` + own `*.module.ts` ONLY                                                                                         |
| `*.module.ts`                                   | own `presentation` + `application` + `infrastructure` + `facade`, plus any module `index.ts` / `core` / `coreCqrs` / `shared` |
| `bootstrap` (`src/instrument.ts`, `tracing.ts`) | `shared`, `core` ONLY                                                                                                         |

**The table lists INTERNAL targets only**: `ONLY` limits which ELEMENTS a file may reach, not its npm surface — every element may also import npm packages and Node builtins, except where the first bullet forbids it.

What the table alone does not say:

- **`domain` AND `shared` are pure TypeScript** — no npm package (Node builtins stay legal). `shared` is held to the same bar because `domain` imports it: a package admitted there reaches `domain` transitively.
- **Every "own" in the table means the file's OWN module**, so cross-module traffic is legal only into a module `index.ts`, and only from `infrastructure` or `*.module.ts`. A `*.module.ts` may also reach its OWN `facade` — wiring inside the context, not a crossing.
- **`application/` reaches core's contract surface only** (ports, exceptions, types, utils) — never a core adapter; adapters arrive by DI (§ Dependency Injection). Enforced by the barrels themselves: no concern `index.ts` exports an adapter class — the owning module binds it via deep import, which is internal wiring, not a crossing.
- **`core/cqrs` is its own element (`coreCqrs`) for ONE reason**: a `*.facade.ts`, otherwise confined to its `application`, may open this single core door and no other. Dispatching edges (§ CQRS) reach it like any core concern; traffic is one-way — `coreCqrs` imports `core`, never the reverse (a cycle); `domain`, `infrastructure`, `bootstrap` never reach it, using ports rather than the pipeline.
- **Every file must belong to an element** — what makes "no fourth pillar" enforceable: a file under no layer is rejected.
- **`src/main.ts` and `src/app.module.ts` are the only exempt files**: composition roots must see everything, and nothing may import them back. `src/instrument.ts`/`src/tracing.ts` are NOT exempt — a `bootstrap` element restricted to `shared` + `core`: starting Sentry/OTel never reads into a module.
- **Import hygiene, equally machine-enforced**: no relative imports (always absolute from `src/` or `test/`); `src/` never imports a devDependency — it would die at container start under `npm ci --omit=dev` (co-located `*.spec.ts` is the sole exemption); cycles INSIDE one layer are caught by their own rule, since the layer rules constrain direction only BETWEEN layers and `forwardRef()` is prohibited (§ Module Isolation).
- **Boundary rules cover `src/` only** — `test/` is deliberately outside them (§ Testing Rules).

### 2. Module Isolation & the Facade

- **The Facade is the single door into a bounded context, reached through `module/<ctx>/index.ts`** — never by importing `<ctx>.facade.ts` directly (§ Barrels). Sole exception: the context's own `*.module.ts`, which provides and exports it. A context no other context reads has no facade and no `domain/` when it owns no aggregate (`audit-trail`, a read-only projection): its barrel exports the Module alone — an empty facade is a box nobody opens.
- **A Facade exposes READ/Query only**, or pre-transaction validation, dispatched as an edge (§ CQRS); anything that must mutate elsewhere goes async (§ Events). It MUST return the **query's own flat result type** (`get-user-auth-state/query.ts` → `GetUserAuthStateResult`) — never a Drizzle object, an Aggregate Root, or a presentation `*.dto.ts`.
- **`forwardRef()` is PROHIBITED** — resolve circular deps via EDA (§ Events).

### 3. CQRS Discipline

**Contracts**

- **Commands** extend `Command<R>` — the typed base carries the result type — mutate state, and return only the affected entity's `id` (or `void`). The Aggregate mutates itself; hand the whole Aggregate to its port. **Exception**: auth token-generation commands (login, refresh) may return `{ accessToken; refreshToken }` — ephemeral tokens that cannot be re-queried.
- **Queries** extend `Query<T>` and NEVER mutate. They read through the **query port** (reader adapter) into a **read-model** — the query's result `type`, co-located in its `query.ts`. The typed base carries that type, so any dispatching edge infers it: never re-import a result type at the call site, never annotate from `domain/`.
- **Every query owns a thin outbound port (ISP).** The handler depends on **one purpose-specific port** exposing only its read — never a broad or foreign port (a health-summary handler must not inject the full cache/database ports for a liveness flag). A read **composed from other ports** is composed in the port's **adapter**, never the handler — even for pure forwarding+merging, because the value is the narrowed contract. (Cardinality: § Adapters.)

**Transport — the pipeline, never the raw bus or a hand-run port**

- **Every EDGE dispatches through the pipeline.** Controller, Facade, event listener and cron enter the application core through `QueryPipeline`/`CommandPipeline` (`core/cqrs`), never the framework `QueryBus`/`CommandBus` and never by invoking a use case by hand: the pipeline is the one seam cross-cutting concerns (caching, invalidation, later tracing) hang off.
- **A handler is the opposite** — it `@Inject(TOKEN)`s its **port(s) directly** (a query handler reads on its own port; a command handler loads/saves and reads on its ports) and must NEVER touch the pipeline or a bus: a write decision must not run on cached/stale data, and a bus hop hides the dependency graph.
- **Folder consequence**: `handler.ts` present = pipeline-dispatched, absent = port-invoked; the result type always stays in `query.ts`, the contract in `port.ts`.
- **Every command/query payload field and every result field is `readonly`, arrays as `readonly X[]`** — a payload must not change after `cacheKey()` is computed, and a result is a snapshot a cache may hand out again; the edge maps it into a DTO, never edits it in place.
- **The single exemption is the liveness probe** (§ Health Probes): reaching the handler method IS its entire answer — an edge with no use case behind it, not a shortcut around one.

**The pipeline WRAPS, never replaces, the framework buses.** `QueryPipeline`/`CommandPipeline` compose an ordered behavior chain (middleware onion) around `QueryBus`/`CommandBus` — a token override can't work because `ExplorerService` binds handlers to the `CqrsModule`-scoped bus, so `CqrsPipelineModule` wraps that bus and re-exports `CqrsModule` (handler registration still needs it). Two behaviors ship, each keyed off an opt-in interface the query/command implements:

- **`ICacheableQuery`** (`cacheKey()` + `cacheTtlSeconds`) → `QueryCachingBehavior` runs cache-aside. Caching is a property of the QUERY, never the caller: the same query caches wherever it is dispatched.
- **`ICacheInvalidatingCommand`** (`invalidatedKeys()`) → `CacheInvalidationBehavior` evicts those keys after the command succeeds — path 1 of the dual-path invalidation model (§ Events).
- **`TracingBehavior` is the outermost behavior on both pipelines**: one span per dispatched command/query (`command RegisterUserCommand`), so a use case is named in its trace whichever edge dispatched it, and Tempo's span metrics count it as one thing. It only records and rethrows — logging and the HTTP mapping stay the global filter's.
- **Fail-open lives in the cache adapter, NOT the behaviors.** The adapter swallows every Redis error (get→null, set/delete→no-op); its only throw is `SystemException` on an empty key — a bug that MUST surface as 500 + Sentry. Never wrap a behavior in try/catch.

### 4. Data & State Boundaries

- **Schema-per-module**: each module owns its Drizzle schema in a PostgreSQL logical schema named after the bounded context (e.g. `user.user`). No central registry; only the owner reads/writes its tables. **Sole core-owned schema: `audit.audit`** (§ Audit) — evidence every module writes is cross-cutting, not a context's state; `drizzle.config.ts` lists that one schema file beside the module glob. **Its one reader is `module/audit-trail`**: core writes the trail, that context reads it through the `audit` table exported from the core barrel (a data contract, not an adapter) — read-only, replica-bound, no writer, domain or facade.
- **No cross-module JOINs.** Merge multi-module data in RAM via Facade calls (API Composition).
- **Soft links only**: store the UUID as a plain string column — no FK constraints.
- **Every id is a UUID v7, so id order is creation order** — listings sort by `id DESC` and indexes end in `id DESC` on that promise. An aggregate's id is minted by its creating command handler (domain identity); a core-owned table with no aggregate behind it (`audit.audit`) mints it in the schema's `$defaultFn` — never `gen_random_uuid()`, which is v4 and loses the ordering.
- **No synchronous cross-module transaction.** Cross-module state is reconciled asynchronously (§ Events).
- **Stateless**: never store session data in local memory — use Redis.
- **Two database connections; the primary is the default, the replica an opt-in.** `core/database` provides `TOKEN_DATABASE_CLIENT` (primary) and `TOKEN_DATABASE_REPLICA_CLIENT` (`DATABASE_REPLICA_URL`, resolving to the primary client when unset). Primary: every write, every read that feeds a write decision (login, refresh, session reconciliation), and every `ICacheableQuery` — a cache populated from a lagging replica pins the stale row for the whole TTL. Replica: presentational reads that tolerate replication lag (lists, searches). The adapter makes the choice, never the handler.

### 5. Events & Messaging

Async Domain Events are required when a mutation must trigger reactions in other modules.

- **Publish through `IEventPublisherPort`** (`TOKEN_EVENT_PUBLISHER_PORT`) — never inject `EventEmitter2` directly; the port keeps the transport swappable when the outbox lands. Lint bans the `EventEmitter2` import everywhere except `src/core/event-bus/`; `@OnEvent` and `EventEmitterModule` stay legal — the subscribe and wiring sides have no port to route through.
- **Events carry ONLY minimal metadata** — the on-bus contract is `DispatchedDomainEvent` (`shared/application/event`), typed on both the publisher port and every listener, so a fuller payload fails compilation — and are **never trusted as current**: the listener re-reads from DB or Facade when it runs. **Listeners stay idempotent**, because at-least-once delivery is the destination. `eventId` (the idempotency key) is generated at the emit site, never in the adapter — a future outbox retry must re-deliver the SAME id.
- **Where a listener lives is decided by where the event was EMITTED — never by what the listener does.**
    - **Emitted by our own application, handled in-process** → that module's `application/event/`; nothing crossed a process boundary.
    - **Emitted by another source, arriving over the network** (Postgres `LISTEN/NOTIFY`, a broker topic, an inbound webhook) → `presentation/listener/` — an inbound adapter exactly like a controller: it terminates a transport.
- **A listener is an EDGE (§ CQRS): it dispatches a command, it does not run the use case inline.** A reaction that mutates state forwards only the `aggregateId` to a command (e.g. `ReconcileUserSessionCommand`); the read-and-write work and its idempotency live in that command's handler, on the handler's own ports. The lone exception is cache eviction — a cross-cutting infra reaction, not a domain use case — where the listener injects the cache port and calls `delete` directly.
- **Same-module cache invalidation runs on TWO deliberate paths.** (1) The synchronous `CacheInvalidationBehavior` on the command pipeline (§ CQRS) — immediate but best-effort — closes the staleness window in the happy path. (2) A domain-event eviction listener, the RELIABLE guarantee once the outbox makes in-process delivery atomic + retried (`delete` is idempotent, so no inbox). Both derive keys from ONE `CacheKeys` helper (`<module>-cache-key.util.ts`), so a rename cannot make them address different entries. The listener stays **in-process** in `application/event/`: a module owns its cache in every deployment, so same-module eviction never crosses a process boundary and never belongs on a broker.

#### Reliable messaging — NOT YET IMPLEMENTED

**Delivery is UNRELIABLE — a known, accepted gap.** Events are emitted in-process via `IEventPublisherPort.emitAsync` (`@nestjs/event-emitter`). There is no outbox table, relay, queue, or broker — an event is lost if the process dies after the DB commit, and a listener failure never retries.

- **Do not pretend otherwise.** Never write code, comments, or docs implying at-least-once delivery, retries, or transactional atomicity between a DB write and an event.
- **Do not invent the outbox piecemeal.** No ad-hoc `outbox` table, dedup ledger, relay cron, or queue module until the pattern is designed as a whole — a half-built outbox looks reliable and isn't.
- **Weigh this when designing.** If a flow cannot tolerate a lost event, raise it rather than silently shipping it over `emitAsync`.
- **Planned (not present):** transactional outbox — critical events INSERTed into `outbox` in the same SQL transaction as the entity write, drained by a relay worker that **re-emits them in-process via `emitAsync`** (the outbox buys atomicity + retry, NOT a new transport — the two are orthogonal), marking a row processed only once its listener succeeds; consumers idempotent; status updated, never deleted; an inbox for effects harmful to repeat. A broker enters ONLY when a consumer is extracted to another process — an in-process reaction (e.g. same-module cache eviction) never needs one.

### 6. Dependency Injection

Always use NestJS Custom Providers (TS interfaces are erased at runtime):

1. Define the Symbol token in the same file as its port interface.
2. Inject with `@Inject(TOKEN_NAME)` in `application/`.
3. Bind with `{ provide: TOKEN_NAME, useClass: SomeAdapter }` in the module — several tokens may bind to the same adapter class.

**An adapter parameterized by a VALUE (which connection, which role) is a plain class built by a `useFactory` provider, with no Nest decorators** (`DatabaseHealthAdapter`, one instance per connection). Adding `@Injectable`/`@Inject` there is not a fix: the container cannot supply the value, and the instances must stay distinct.

**Extending a framework class that injects its own constructor params (any library-provided guard, interceptor or service): re-declare ITS `@Inject`s alongside yours.** Any `@Inject` on the subclass writes that class's own dependency metadata, SHADOWING the base class's rather than extending it — so adding one token silently makes the inherited ones unresolvable at boot.

**No module of ours is `@Global()`.** Every module explicitly imports each module whose exported provider it injects, so each `*.module.ts` is a complete manifest of its own dependencies — the visible extraction cost of a bounded context, which a global scope would hide. Injecting a token has two obligations: the `@Inject` AND the providing module in `imports`. Enforced at boot (Nest throws on an unresolved provider) and at review, not by lint — the layer rules constrain import direction, not DI wiring. **Sole exceptions**, both deliberate: `ConfigModule` (NestJS's canonical `isGlobal: true` — config is universal) and `EventEmitterModule.forRoot()` (global by framework design).

## Project Structure

Three top-level pillars, each with one job — and no fourth may be added:

- **`src/shared/`** — pure, framework-free primitives any layer may use.
- **`src/core/`** — the platform kernel: cross-cutting technical concerns as port + adapter + NestJS wiring. No business rules, no domain entities.
- **`src/module/`** — the bounded contexts.

Group by bounded-context → hexagonal layer → role.

```
src/
  main.ts                     # composition root — exempt from boundary rules
  app.module.ts               # composition root — exempt from boundary rules
  instrument.ts               # Sentry bootstrap  — `bootstrap` element, may reach shared + core only
  tracing.ts                  # OTel bootstrap    — `bootstrap` element, may reach shared + core only
  shared/
    domain/                   # SHELF (no index.ts): admin/  user/  principal/  event/  aggregate-root/
    application/              # SHELF (no index.ts): event/
    exception/  pagination/  search/
  core/
    cache/  config/  cqrs/  database/  doc/  email/
    event-bus/  exception/  http/
    observability/            # SHELF (no index.ts): audit/  exception-tracker/  logger/
    security/                 # SHELF (no index.ts): auth/  hashing/  password/  session/  token/
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

1. **Does it belong to exactly one contract?** (a port's payload, an exception's message vocabulary) → put it INSIDE that contract's file. They change together; splitting forces two edits.
2. **Does it have an owner?** (who would _change_ it — not who _uses_ it) → put it next to the owner; others import from there.
3. **Is it genuinely shared vocabulary?** → one descriptively named file at the concept's root. But check first: if changing it for one consumer would break the other, that is coupling, not sharing — merge the concepts or duplicate the shape.
4. **None of the above?** → the concept boundary is wrong. Split the concept, not the file.

### 2. Folders — decided up front by the role's nature, never by file count

The test is NOT "how many files exist now" but **"can this role ever have more than one member?"** If yes, build the plural structure from the first file — no path ever churns.

- **Plural roles — own folder from the first file**: `adapter`, `port`, `command`, `query`, `listener`, `cron`, `event`, `controller`, `dto`, `decorator`, `guard`, `filter`, `hook`, `interceptor`, `pipe`.
- **Singular roles — stay flat, never get a folder**: `module`, `facade`, `schema`. One per concept by definition; a folder here is an empty box. **No wrapper folder either** — the schema is `infrastructure/<module>.schema.ts`, never `infrastructure/database/<module>.schema.ts`: a data source is an axis carried by the **filename** (`user-cache-reader.adapter.ts`), never by a folder.
- **Growth axis is the sub-concept, never the kind.** A concept accreting a large type family must split into sub-concepts (`email/` → `sending/`, `ledger/`, `queue/`, each carrying its own types/enums/ports) — the swelling means the concept does too much. If you cannot name the result, either the split isn't needed or the result is a bag with no identity.

### 3. Naming

- **Everything is singular** — folders (`dto/`, `adapter/`) and files (`user.controller.ts`), never plural.
- **Role suffix, dot-separated**: `emailer.port.ts`, `user.schema.ts`, `admin.facade.ts`. Never a hyphen — `email-type.ts` reads as "a thing called EmailType"; `email.type.ts` reads as "email, a type file". Two separators in one folder is noise.
- **KIND is never a folder, and never a file's IDENTITY** — `type`, `enum`, `constant`, `util`, `interface`, `class`, `payload`, `common`, `shared`, `helper`, `misc`. A kind names a language keyword, not content, so as a folder or as a file's name it separates things that change together and collocates things that don't: `util/`, `common.ts`, `type.ts` are never correct, at any size. **The test**: can you name the file after its CONTENT without the words "type"/"constant"/"util"? If not, the **Placement** questions were skipped. A kind may appear ONLY as the dot-separated suffix of a content-named file that Placement 3 already justified (`principal.type.ts`, `user-cache-key.util.ts`) — and a ROLE suffix wins wherever one applies. (The three pillars are not kind folders; the ban targets folders opened _inside_ a concept, and nothing below the pillars may reuse their names.)
- **Bare ROLE names** (`port.ts`, `adapter.ts`, `handler.ts`, `command.ts`, `query.ts`, `module.ts`) depend entirely on the parent folder:
    - **Inside a CONCEPT folder → required.** `command/register-user/command.ts`, `.../handler.ts`, `.../port.ts`. The folder names a concept and holds one file per role, so it fully supplies identity; re-stating it (`register-user.command.ts`) is stutter.
    - **Inside a KIND or ROLE folder → forbidden.** `adapter/adapter.ts`, `command/port/port.ts` read only because of the folder, so they die on move (indistinguishable stack traces) — use the role suffix: `user-reader.adapter.ts`, `user-writer.port.ts`.

### 4. Barrels — a barrel is a BOUNDARY, not an alias

The only test: _does an outsider import from here, and are the inner files off-limits to them?_

- **Yes → add the barrel, and then NOBODY may deep-import past it.** A barrel used alongside deep imports into the same folder closes nothing.
- **No → do not add one.** A barrel nobody imports from is one more file to maintain.
- **A barrel exports by NAME, never `export *`, and lists only the consumed surface** — the export list IS the concern's public API, so it must be readable as one. Export what outsiders consume, plus what is deliberately designed for them to consume later; internal wiring (adapters, behavior classes, connection tokens) never crosses, even though its own file exports it.

| Level                                                                                                                                 | Barrel? | Why                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bounded context (`module/<ctx>/`)                                                                                                     | YES     | A real boundary. Exposes ONLY the Facade + Module.                                                                                                                                                                   |
| A `core`/`shared` **concern** — the independently consumed one                                                                        | YES     | The concept's public API. Consumers enter only here.                                                                                                                                                                 |
| Everything else: shelves (`core/security/`), hexagonal layers, role folders (`adapter/`, `dto/`), concept folders (`command/<name>/`) | NO      | Not a boundary. A shelf or a layer is a bag of concepts — a broad, cycle-prone surface, the classic cause of circular deps in layered DDD; a role or concept folder is a mere alias that hides the dependency graph. |

**In `core/` AND `shared/`, "concern" is not a fixed depth — it is whatever outsiders consume as ONE thing.** The barrel goes on the **deepest node imported as a whole**; every folder above it is a shelf with no `index.ts`. `core/cache/` and `shared/pagination/` are each consumed as one capability → barrel. `core/security/` and `shared/domain/` shelve capabilities consumed separately by unrelated callers → the barrels sit on the capabilities, and **`core/security/index.ts` / `shared/domain/index.ts` must not exist**. So `index.ts` exists in exactly three kinds of place — `module/<ctx>/`, a core concern, a shared concern — and stacked barrels are impossible: if two levels both look right, the parent is a shelf.

**Machine-enforced**: every `core`/`shared` concern is declared in `eslint.config.mjs`, which makes its `index.ts` the only legal entry; a shelf is declared so that its CHILDREN become the elements instead. **Adding a folder under `core/` or `shared/` is therefore a two-file change: the folder AND its element entry**, whose form is this shelf-vs-concern decision — that file's comments give the exact syntax. `test/architecture/boundaries-element.spec.ts` verifies each entry against whether `index.ts` exists on disk.

**NEVER use a barrel as a design justification.** "It goes through `index.ts` anyway" would equally defend one 5000-line file; a barrel only flattens the CONSUMER's view, and organization is for the person opening the file to change it.

### 5. Adapters — the seam is "what changes together", not a project-wide label

Do NOT impose one uniform adapter split everywhere. Ask per concern: **do the read and write sides change for different reasons and depend on different things?**

- **Inside a module: YES → split reader / writer** (CQRS projected onto infrastructure). The writer injects DB + event bus + logger, takes the Aggregate, and `implements` exactly one write port; the reader injects the data source only, returns read-models, and accretes an `implements` clause per query. They change at different rates, so must not share a class.
- **Inside `core/`: NO → split by CAPABILITY instead** (`cache` / `cache-health` / `cache-cleaner`). A capability's get and set change for the same reason, over the same connection — `CacheReaderAdapter`/`CacheWriterAdapter` would be pure ceremony, and some concerns have no read side (`IEmailerPort.sendEmail`). If a core concern's read and write sides diverge, split the **concern** into sub-concepts, not the adapter.
- **Adapter count = data source × (read/write).** A module reading from a second source (e.g. cache) gets its own reader for THAT source — the axis is the source, not read/write. Never bolt a second data source onto an existing reader. **The replica is a source of its own**: `<module>-reader.adapter.ts` injects the primary, `<module>-replica-reader.adapter.ts` the replica, and a port sits in one or the other by the consistency test (§ Data & State Boundaries).
- **One reader per data source implements every thin read-port of that source** (`AdminReaderAdapter` — one `*-reader.adapter.ts`, injecting the data source once), never one adapter per port; handlers still see only their thin port.
- **Readers consolidate, writers are singular, and a module that never writes has no writer** — do not open an empty box.
- **Every aggregate row carries an optimistic lock, and the writer enforces it.** `AggregateRoot` owns `version` — the persisted version the state was LOADED at (0 when new), never advanced in memory — and the schema mirrors it as `version integer`. `save()` is one conditional upsert: insert at the loaded version, or `ON CONFLICT DO UPDATE ... SET version = loaded + 1 WHERE version = loaded`; zero affected rows means another request wrote the row between load and save, and the writer throws `ResourceConflictException(CONCURRENT_MODIFICATION)` — a decision made on stale state must be refused, never allowed to overwrite a concurrent ban, revocation or deletion. Not a row lock: a lock lives only inside a transaction, which would pin a connection across the handler's whole load→save span (argon2 included). Append-only tables (`audit.audit`) and single-statement atomic updates need no version. Every mutating endpoint behind such a writer therefore documents the `409`.
- **Writers own driver-error translation.** A constraint violation is meaningful only to the schema's owner, so the writer catches the driver error at the port boundary and rethrows the matching taxonomy exception with `{ cause }` (unique-violation on `email` → `ResourceConflictException(EMAIL_IN_USE)`). Classification predicates live in `core/database` (`isUniqueViolation`); a raw driver error never escapes infrastructure.
- **Connection failures are translated by EVERY database adapter method** — reader and writer alike — by ending its `catch` with `throw translateConnectionFailure(error)` (`core/database`): the helper only TRANSLATES (returns `DependencyUnavailableException` for an unreachable database, the original error otherwise — 503 silent per request, the episode logged at the connection level, § Dependency outages; everything else stays 500 + Sentry), while the `throw` stays at the adapter's call site. Two deliberate non-sites: the database health adapter (its raw throw feeds the indicator, § Health Probes) and the test-only cleaner.

## HTTP Layer

### Guards & Auth

- `AuthenticationGuard` (JWT) and `AuthorizationGuard` (permissions) are global. Mark public endpoints with `@Public()`.
- **Authorization is permission-based, never role-based.** The catalog is static code (`shared/domain/principal`: `Permission`, named `<context>:<resource>:<action>`, plus `PERMISSION_HOLDER`, which fixes the ONE kind of principal each permission may be held by and is exhaustive over the enum); who HOLDS a permission is dynamic — a `permissions text[]` column per principal, carried verbatim in the access token, so the guard decides without a store round-trip. A route declares `@Permissions(...)` (ALL required; holding one already pins the caller's kind) or, for a self-scoped `me` route, `@PrincipalOnly(PrincipalType.X)`; a route declaring neither admits any authenticated principal. `PrincipalType` (`admin` | `user`) says only which context owns `sub` — never authority.
- **`PrincipalAggregateRoot` (`shared/domain/aggregate-root`) owns permissions, the two session counters, and ONE administration rule — only an admin administers (`assertAdministrableBy`, a `SystemException` guard); it names no concrete permission. The rank hierarchy is the `Admin` aggregate's own invariant**, layered on by overriding that guard (`super` first) plus a private check on the requested set — three tiers within the kind: ROOT (`admin:root`, a tier marker held by exactly ONE account, enforced by a partial unique index, never granted over the API — root transfer is manual SQL), MANAGER (`admin:permission:manage`, appointed and dismissed by root only), ordinary. Root administers anyone; nobody administers root or their own account; a manager administers ORDINARY admins only (gives and takes every ordinary permission, bans, deletes); a manager is administered by root alone, in every respect. Cross-kind (admin on user) no rank applies — an admin can never hold a user's permissions — so the guard's permission alone decides and `User` overrides nothing; a non-admin reaching an administering mutation is a `SystemException`. A permission change replaces the WHOLE set (`PUT …/:id/permission`, idempotent, one audit record whose `detail` names what was granted and revoked) and retires the ACCESS tokens only: the principal carries two counters — `sessionVersion` (the floor an access token must reach at `AuthenticationGuard`, and what new tokens are minted at) and `revocationVersion` (the floor a REFRESH token must reach to be rotated); ban, deletion, password change and reuse revocation move both (`revokeAllSessions`, sign in again), a permission change moves the first alone (`retireAccessTokens`), so the client's next refresh mints an access token carrying the new set without a login. Redis holds `sessionVersion` only — the refresh floor is read from the primary, where refresh already reads. The actor reaches the command as a `Principal` (`@CurrentPrincipal()`, built from the verified token) — a business rule never reads HTTP.
- **No bootstrap command yet**: the first admin and its full catalog are inserted by hand (SQL); a one-off bootstrap task is planned for deployment.
- **Session revocation is fail-closed on the version key, and the invariant spans files.** Every login and refresh writes `version:<id>` (monotonic-max, TTL = refresh lifetime, renewed on every write); `AuthenticationGuard` rejects a missing key with 401 (dead session) and an unreachable store with 503. Three things look like defects and must NOT be "fixed": `getVersion`'s `null` is never coerced to a permissive default; login's `setVersion` stays uncaught (a login that cannot write the key must 503, not mint dead-on-arrival tokens); the silent `setVersion` catches in ban/delete/revoke/password handlers stay silent — they are the best-effort fast path, the guarantee is the guard's default-deny, and the durable retry arrives with the outbox. Revocation bumps the version, never DELetes the key: a login racing the bump would resurrect it with a stale write, which the monotonic-max rejects. `redis-session` runs AOF because under fail-closed, data loss means mass logout; `redis-cache` deliberately does not.
- **There is NO rate limiting — deliberately, and it is still to be built.** The previous implementation was removed whole rather than left half-right; the target architecture, its decisions and the build order live in `docs/issue/rate-limiting.md`. Read that file before adding anything throttle-shaped, and do not reintroduce a piece of it ad hoc (a limiter here, an env var there): partial rate limiting reads as protection and isn't. Nothing else depends on it.

### HTTP Caching

Two halves in `core/http/caching`: **`HttpCacheInterceptor`** writes `Cache-Control` from the route's `@HttpCache(HttpCachePolicy.X)`; **`httpCacheHook`** (a raw Fastify `onSend` hook registered in `main.ts` beside `auditContextHook`) puts a weak `ETag` on every `200` to a cacheable read, answers `304` on a matching `If-None-Match`, and stamps `no-store` on any reply leaving without a policy (guard refusals, unmatched routes) or with an error status.

- **EVERY GET/HEAD endpoint declares its policy with `@HttpCache`; every other method gets `no-store` automatically and must NOT carry one.** The interceptor throws `SystemException` on both, so a missed endpoint fails as 500 + Sentry on its first request. **`@HttpCache` goes on the METHOD, never the class**: a class-level policy is inherited by every handler, so the first POST added to that controller boots fine and 500s on its first request. Choose by asking "is a stored copy of this answer ever wrong?": probes and anything tied to an instant → `NO_STORE`; identity-scoped reads (the default) → `PRIVATE_REVALIDATE`; identity-free data a CDN may hold → `PUBLIC_REVALIDATE`.
- **Every request reaches the server: HTTP caching saves BYTES, never round-trips.** No policy grants freshness (`max-age`) — a fresh copy is served without reaching the server, so the guards never run (a revoked session keeps reading), the `@Audited` record is never written, and no invalidation reaches the copy. Cutting round-trips is the CLIENT's job (a stale-while-revalidate client cache). The sole admissible exception is identity-free public data, never an `@Audited` route, and only as a design decision.
- **The ETag saves the transfer, never the query** — the handler still runs; compute savings are `ICacheableQuery`'s job (§ CQRS).
- **A BFF proxy stays transparent**: it forwards `If-None-Match` inward and `ETag`/`Cache-Control`/`304` outward with its own fetch cache off; the browser holds the validator, so the proxy stays stateless.

### DTOs

| Type         | Prefix      | Example                                          |
| ------------ | ----------- | ------------------------------------------------ |
| Request body | HTTP method | `post-user.dto.ts` → `PostUserDto`               |
| Query params | `query-`    | `query-pagination.dto.ts` → `QueryPaginationDto` |
| Response     | `response-` | `response-user.dto.ts` → `ResponseUserDto`       |
| Error        | `error-`    | `error-default.dto.ts` → `ErrorDefaultDto`       |

**Class-level:**

- `@ApiSchema({ name, description })` on EVERY DTO. `name` is the class name without `Dto` (`PostUserDto` → `'PostUser'`); `description` is a real sentence explaining what the schema is for — never a restatement of the name.
- JSDoc above the class explaining _why_ it exists (what it enforces or guarantees).
- **EVERY DTO carries the whitelist**: `@Exclude()` at class level + `@Expose()` on every property. On a response DTO this is the guarantee that anything not `@Expose()`d never reaches a client; on a request DTO it costs nothing and survives the day someone repurposes the class as a response. A mapped-type DTO (`PartialType`/`OmitType`) re-declares only the class-level `@Exclude()` — property metadata is copied from the source class.

**Per property — all three, always:**

1. **JSDoc** describing the field's meaning.
2. **Validation + documentation, in this order of preference:**
    - **A composed decorator from `src/core/http/validation/decorator/` if one fits** (`IsEmailAddress`, `IsStrongPassword`, `IsEntityId`, …) — checking that folder first is MANDATORY: the decorator bundles `class-validator` rules AND `@ApiProperty` in one call, keeping each limit in exactly one place. The field-label prefix feeds both the Swagger description and the error messages — pass it ONLY when it must deviate from the decorator's default (`@IsStrongPassword('The current password')`); restating the default at the call site duplicates the value and silently goes stale.
    - **Otherwise, raw `class-validator` rules + an explicit `@ApiProperty`** — the correct outcome for a genuinely one-off field.
    - **Every rule carries a custom `message` built from the field label** — a class-validator default never reaches a client: it leaks code identifiers (camelCase property names, `Matches` even embeds the regex source) and mixes styles within one error response. Applies to composed decorators and raw stacks alike; boot-time validation (`env.validation.ts`) is exempt — it talks to an operator, where the property name IS the needed message.
    - **Exception — response DTOs never carry raw `class-validator` rules.** Nothing validates an outgoing body at runtime, so a validator there is dead code posing as a guarantee; `@ApiProperty` alone must express every constraint (`minimum`/`maximum`, `minLength`/`maxLength`, `minItems`, `enum`) the field's contract implies. A composed decorator on a response DTO stays — it is the single source of that field's `@ApiProperty` metadata.
3. **`readonly`** — always. **Required** field: definite assignment, `readonly email!: string`. **Optional** field: `?` plus `@IsOptional()`, `readonly search?: string`. `!` and `?` are mutually exclusive in TypeScript, so an optional property NEVER carries `!`.

**A shape earns a composed decorator on its SECOND use, never the first.** The decorator folder holds shared field vocabulary, so a single-use decorator must never go there. On the second use, promote the raw stack into a composed decorator and migrate both call sites — the limits then live in exactly one place.

**Never leave a property undecorated** — DTO validation is the trust boundary, so such a field is both unvalidated input and undocumented output. None of the above is optional where it applies: a DTO that falls short is incomplete work, not a draft.

### Responses & Errors

- `ResponseInterceptor` wraps all responses — do not wrap manually.
- Throw the taxonomy classes from `src/shared/exception` — never NestJS HTTP exceptions (§ Exceptions).
- Use `QueryPaginationDto` for pagination input, `ResponsePaginationDto` for output.

### API Documentation

**Documentation first**: every controller endpoint needs `@ApiTags`, `@ApiOperation`, and `ApiDefault*` decorators. Before adding a raw `@ApiResponse`, check `src/core/doc/decorator/` for an existing `ApiDefault*`.

**A status's description must cover EVERY reason that endpoint can return it.** Swagger allows one description per status, so the choice is decided by how many rejections share the code, never by which one comes to mind first:

- **One deliberate cause** → pass that message: `@ApiDefaultResourceConflictResponse(ResourceConflictMessage.EMAIL_IN_USE)`.
- **Several causes** → pass nothing; the generic `DEFAULT` is correct — naming one of five reasons documents the endpoint as if the other four did not exist.

Never invent a per-endpoint message enum to enumerate causes — the client branches on the status code, and the body already carries the specific message at runtime.

**`core/doc` knowing the module tag names (`APITag` + per-version descriptions in `doc.config.ts`) is a deliberate, narrow concession** — like the health-route constants (§ Route & Prefix Literals): document composition sees the whole API by nature, and keying the config by tag and version makes a new module or version fail compilation until its description exists.

### Health Probes

Three endpoints split by AUDIENCE, and the split is load-bearing:

- **`/health/live`** — public, `204`, checks **nothing**. A dependency check here would let one Redis/Postgres outage restart every otherwise-healthy instance. It is the sole edge that dispatches no use case (§ CQRS).
- **`/health/ready`** — public, checks every dependency, answers `204`/`503` with **no body**. The caller is a load balancer branching on the status code; a body would disclose the dependency topology to anonymous callers. The container `HEALTHCHECK` and a k8s `readinessProbe` point here, never at liveness.
- **`/health`** — the per-indicator detail, `@Permissions(Permission.HEALTH_DETAIL_READ)`: naming which dependency is down is reconnaissance material.
- **`database` and `database_replica` are two indicators, always both present** — the set is fixed at compile time (`HEALTH_INDICATOR_KEYS`), and readiness must fail when replica-bound reads would 503. Without a replica, `TOKEN_DATABASE_REPLICA_HEALTH_PORT` is the primary's own probe object, so the indicator reports the connection those reads run on and one outage logs one episode.

Two consequences look like defects and MUST NOT be "fixed":

- **The health adapter lets Terminus's raw `ServiceUnavailableException` escape** — the one exemption to "infrastructure translates, nothing leaks" (§ Exceptions). The filter's passthrough keys off `instanceof HttpException`, so translating it into a taxonomy `DependencyUnavailableException` would silently re-normalize both probes and put an `ErrorDefaultDto` body back on the readiness probe.
- **During a cache outage `/health` is unreachable** — `AuthenticationGuard` fails closed, so the operator view answers `503` from the guard before an indicator runs. Accepted: `/health/ready` still reports the instance as not serving, and the forensic path during an outage is the connection-level `LOST`/`RESTORED` log (§ Dependency outages), not this endpoint.

## Exceptions

Who owns what, from throw to HTTP response — each concern lives in exactly one place.

- **`src/shared/exception` owns the taxonomy.** Abstract `AppException` (transport-neutral `ExceptionKind` + `AppExceptionOptions`) and its subclasses (e.g. `ResourceNotFoundException`), each co-locating its `*Message` enum (§ Placement 1). The taxonomy knows no HTTP, no framework.
- **Message vocabulary follows the thrower.** A shared `*Message` enum holds only messages generic to the kind (`DEFAULT`, `EMAIL_IN_USE`); a use case's own rejection messages live in its `command.ts` (e.g. `RefreshTokensMessage.CONCURRENT_REFRESH`); a single-thrower message is inlined at the throw site (§ Variable Inlining); a core-owned thrower keeps its vocabulary in its own concern. Never grow a shared enum for one module's need — every `ApiDefault*` decorator takes `message: string` defaulting to the shared `DEFAULT`, never an enum type, so core never learns a module's vocabulary. Vocabulary shared by several commands of one module lives in one descriptively named file at that module's `application/command/` root.
- **HTTP request-validation vocabulary is not taxonomy vocabulary.** `RequestValidationMessage` (`PAYLOAD` / `PARAM`) lives in `core/http` because the effective thrower is Nest's `ValidationPipe`, not `InvalidInputException`; `InvalidInputMessage` carries only the vocabulary of code that genuinely throws that exception. Follow the thrower, not the status code they share.
- **Throwers throw; they do not log** (§ Observability). Raise `new ...Exception(message, { context })` and nothing else. `context` is `{ class: string; method: string; [key: string]: unknown }` — only the origin is typed, the rest free-form so `shared` never learns a module's vocabulary; `cause` is reserved for the underlying error. **`context` is diagnostic, read only on the 5xx path: attach it to `SystemException` and unexpected faults, NEVER to a client-facing 4xx** — a deliberate refusal either writes its own audit record (login handlers, refresh reuse; § Audit) or stays silent. No key may come from a consumer of the log (e.g. a logger enum), and **audit vocabulary (`AuditAction`, a rejection-`reason` enum) never enters `context`** — audit is a separate port, not a log subtype.
- **Aggregates own their invariants; the throw-or-no-op test is the requested END STATE.** End state already holds (`ban()` on a banned account) → silent idempotent no-op, no event — re-emitting would lie. Transition would break an owned invariant → the aggregate throws the taxonomy exception itself (`domain` may import `shared`); never trust callers to pre-check. Pick the kind by who can trigger it: client-reachable → a client-facing kind (`InvalidInputException`, `ResourceConflictException`); unreachable through normal flows → `SystemException`, because 500 + Sentry is the intended outcome for a broken code path. Current instance: **a soft-deleted aggregate is immutable** — `SoftDeletableAggregateRoot` (`shared/domain/aggregate-root`) owns it, and every mutator except `markAsDeleted` calls its `assertNotDeleted` (throws `SystemException` with `context`), since writers' `load()` filters `deletedAt IS NULL` and only a bug can hand a deleted aggregate to a mutator. **An invariant shared by several aggregates is hoisted to an opt-in base class, never onto `AggregateRoot`** — a universal base would force every future aggregate to be soft-deletable. Second instance: `PrincipalAggregateRoot` (§ Guards & Auth) — a permission the kind may not hold is `InvalidInputException`; the `Admin` aggregate's self/root/tier refusals are client-reachable, so `AccessDeniedException`.
- **Infrastructure translates; nothing leaks** (§ Adapters owns which class does it). An untranslated infrastructure error surfacing as a generic 500 + Sentry is the correct outcome for the unexpected, never a formatting gap to patch in the filter.
- **The global filter (`src/core/exception`) is the only place the taxonomy meets HTTP.** It maps kind→status via the exhaustive `KIND_TO_STATUS` Record (a new kind without a status fails compilation), renders `ErrorDefaultDto` (every `>=500` body carries the generic `DEFAULT` message, taxonomy or framework alike — a 5xx message is written for the log and Sentry, never the client), and decides logging and audit in this order: `503` silent per request (§ Dependency outages); `>=500` → error log + Sentry, checked FIRST so a `SystemException` cannot degrade to a lesser record, and the ONLY branch that reads `context`, carried verbatim into the log; then `403` → audit `ACCESS_DENIED`, the one refusal the transport itself can attest to per request; everything else silent, including a status the filter sees per REFUSED request but decided once for many (§ Audit). No `warn` branch: nothing below `500` carries `context`, because a client-facing rejection attaches none — a refusal's meaning is recorded by the code that knows it (§ Audit), not guessed from a status code.

## Observability (Logging, Exception Tracking & Audit)

**The app emits telemetry two ways only: OTLP push to the OpenTelemetry Collector, and JSON logs on stdout.** It never names a store or vendor — where the collector ships is deployment configuration (`docker/otel-collector/`), so a backend swap touches no code. Compose files are local tooling and never reach an external service; the ECS task definition carries the same pieces (`docker-compose.observability.yml` header).

**Sentry is the exception tracker only and never owns OpenTelemetry.** `instrument.ts` inits it with `skipOpenTelemetrySetup: true`; otherwise its own tracer provider registers first, samples nothing (no `tracesSampleRate`), and the OTLP exporter in `tracing.ts` never sees a span. `tracing.ts` installs `SentryContextManager` so captured exceptions keep their request scope. `@fastify/otel` (registered in `tracing.ts`) names the request span after the matched route and sets `http.route`; `fs`/`net`/`dns` instrumentations stay off (a span per syscall is noise). `OTEL_SEMCONV_STABILITY_OPT_IN=http` fixes the stable metric names (`http_server_request_duration_seconds`). Postgres queries are traced by `instrumentation-pg` (the `pg` driver was chosen for it). Sampling is the OTel SDK's (`OTEL_TRACES_SAMPLER*`, head) plus the collector's tail policies; the Tempo generator's `metrics_ingestion_time_range_slack` must exceed the collector's `decision_wait`, or every span reaches it too old to count.

Decide per catch/branch by asking **"who acts on this, and does the system fix itself?"** — never log or capture reflexively. A raised exception is logged by the global filter alone (§ Exceptions); command/query handlers never call `ILoggerPort`/`IExceptionTrackerPort` at all.

- **Sentry (`IExceptionTrackerPort.captureException`) → only when a human must intervene and it will NOT self-heal.**
- **`logger.warn` → self-healing failure whose _cause_ is a forensic breadcrumb.** It answers _why_, doesn't alert. Justified only when both hold: (1) something else — a metric or an existing Sentry alert — already detects the incident and brings someone to the logs, (2) the warn carries a root cause not available elsewhere.
- **`logger.info` → operationally significant state transitions**, not routine chatter: what an operator may want after the fact, short of a failure (e.g. a dependency recovering, `ConnectionLogMessage.RESTORED`). Auditable facts are NOT logged here — they go to the audit port.
- **Silent `catch` → fully self-healing failure nobody will investigate.** Swallow with an explanatory comment; no log, no Sentry (e.g. shutdown-cleanup errors — the OS reclaims the socket). The `catch` only stops an unhandled rejection, and **must not throw**.

### Audit — evidence, not operational logs

An audit record answers "who did what, when, from where" to an auditor; a log answers "why did this break" to an operator. They are **separate ports** (`IAuditPort` vs `ILoggerPort`) because a record is EVIDENCE: it cannot be lost, is not subject to the log level, and is written even under `NODE_ENV=test` where operational logs are silenced. The store is the append-only `audit.audit` table on the primary connection.

- **The code that establishes the fact writes the record — and nothing else does.** A state-mutating command `await`s its own `auditPort.record()` after the entity write; the two are one act, so a record that cannot be written fails the command — never fire-and-forget, never swallowed (sole exception: the global filter cannot throw, so it routes its own audit failure through its 5xx decision). Atomicity with the entity write is NOT promised until the outbox lands (§ Reliable messaging); the row is materialized at the call site (`occurredAt`, trace, context; the id by the schema's `$defaultFn`), so a deferred write would carry the same fact. Reading the trail is the `audit-trail` context's job, never core's (§ Data & State Boundaries). The edge records only what it alone owns: the global filter writes `403`→`ACCESS_DENIED`, `AuditInterceptor` writes `@Audited` READ/disclosure endpoints (`PERSONAL_DATA_ACCESSED`, or `AUDIT_TRAIL_ACCESSED` on the trail itself — who inspects the evidence is evidence). **`@Audited` never goes on a mutating endpoint** — that record is the command's (machine-unenforceable, a review rule).
- **An episode gets ONE record, never one per request it affects** — the § Dependency outages rule applied to evidence. When one decision refuses many requests (a rate-limit block, a tripped breaker), the record belongs to the component that can tell the request which CAUSED the decision from the ones merely caught behind it — never to the global filter, which sees every refusal alike. Flooding matters more here than in a log: audit is exempt from the log level, retained by policy, and becomes a table, where a per-request record is a write amplifier any anonymous caller can pull.
- **The context is filled in two phases, each by whoever brings the fact into existence.** `auditContextHook` (a Fastify `onRequest` hook, registered in `main.ts`) seeds the TRANSPORT half on arrival — ahead of every guard, which is what makes a guard-thrown refusal attributable at all; `AuthenticationGuard` publishes the IDENTITY half the moment it VERIFIES a token, so a `403` from the roles guard names the role it was about. Never publish a decoded-but-unverified payload: that is a forged record, not an unattributed one. An interceptor cannot do either job — it runs after every guard.
- **Actor identity reaches the handler via AsyncLocalStorage, never the command payload**, so a command contract never learns HTTP. Outside an HTTP request (cron, listener) the actor is simply absent — the record is still written, only unattributed.
- **A caller passes only what the ambient context does NOT already hold.** `targetId` is the SUBJECT of the action; on a self-scoped route that is the actor the context already names, so passing it makes one principal appear twice under two meanings. Pass it when the subject is genuinely distinct — an admin acting on someone, a `@Public()` route with no actor, or a subject derived from a different credential than the guard verified (`POST /auth/logout` reads the body's refresh token).
- **An audit record is personal data.** Retention is policy-bound; the schema carries only ids and references — never a token, password, or full-PII payload. `detail` (jsonb, `AuditDetail`) carries what changed when the ids alone do not say (the permissions granted and revoked) and is typed to identifiers and enum members only; `actorType` names the context that owns `actorId`, so an actor resolves without probing every table. Transport facts are bounded and sanitized at the hook, not at the writer: the route is Fastify's matched TEMPLATE (`/v1/user/:id`), never `request.url`, whose query string can carry a token; a client-supplied string (`user-agent`) is length-capped.

### Dependency outages — one record per episode, never per request

A downed dependency (Redis, Postgres) fails every call until it recovers, so the question is not _whether_ the cause is worth a breadcrumb but _where_ it is recorded. **The breadcrumb belongs at the CONNECTION level, gated on a state-transition flag; every per-call and per-request failure path stays silent.**

- **The transition site logs** — a `warn` with the driver error and `ConnectionLogMessage.LOST` on the way down, an `info` with `RESTORED` on the way back — once per episode, guarded by an `isDown` flag. The site depends on the driver: ioredis exposes connection events (`core/cache/redis-client.factory.ts`, shared by every Redis-owning concern); `pg`'s pool reports only dropped idle clients (swallowed in `core/database/database-pool.factory.ts`), so the periodic health probe is the transition site (`core/database/adapter/database-health.adapter.ts`) — one instance per connection, each with its own flag, `data.role` naming the connection.
- **Everything downstream is silent** — fail-open cache reads, best-effort session writes, the global filter's `503`. Detection is the health alarm's job and the cause is already named once; per-call records flood exactly when the logs matter most.
- **`ConnectionLogMessage` is shared vocabulary on purpose** (`core/observability/logger`) — an outage reads identically across dependencies, so the two transitions are greppable as one thing.

## Coding Conventions

### JSDoc

Every file MUST start with `@file` + `@description`, and `@file` MUST match the filename — a stale `@file` makes the file lie about itself, misleading search and review. All classes, interfaces, methods, and functions need JSDoc explaining _why_ they exist.

- Comments carry only what a reader of the code needs to know — no filler, no padding: as short as possible while still explanatory.
- Comments state the present design rationale only — never project history or past refactors (that is git's job).
- `@param` MUST NOT include TypeScript types.
- `@throws {ExceptionType}` in curly braces.
- **`@throws` lives on the INTERFACE method** — the contract, not the implementation, owns failure semantics — and documents only CONTRACT-level throws: deliberate taxonomy exceptions, reject-on-failure semantics (health/cleaner pings), library errors the caller must catch. A Facade method is a boundary contract too, despite being a concrete class: it documents the FULL contract-level set, including taxonomy exceptions it merely propagates (e.g. `DependencyUnavailableException` from the read path). Never tag the ubiquitous "an untranslated raw infra error may escape as 500 + Sentry" per method — that is every port's shared unexpected path, and tagging it is noise.
- No `@returns` on `void`/`Promise<void>` methods.
- Decorator functions returning a decorator: describe the value, not the raw type.

### Types & Signatures

- **`interface`** — a **contract or behavior** a class will `implement`: Ports, Repositories, Service contracts.
- **`type`** — a pure **data shape** with no behavior: Command/Query payloads, results, read-models, unions/intersections, utility compositions (`Pick`, `Omit`, `Partial`), tuples.
- The test: "What does it **do**?" → `interface`. "What does it **contain**?" → `type`.
- **`?: X | undefined` is banned; `exactOptionalPropertyTypes` stays ON** — an optional field is absent or holds a real value, never a transported `undefined`. A call site omits the key via conditional spread (`...(targetId && { targetId })`), never `key: cond ? value : undefined`. An `unknown`-typed source needs an explicit boolean check (`...(x !== undefined && { ... })`) — TS cannot spread a truthiness-narrowed `unknown`. Sole exemption: Drizzle's `set: { id: undefined }`, the driver's documented column-exclusion mechanism.
- **Return types**: on an interface, always annotate explicitly (including `void`/`Promise<void>`); on a class implementation, do NOT annotate `void`/`Promise<void>` but DO annotate every non-void return.
- **A branch keyed on a finite enum/union must be compile-time exhaustive** — a new member must fail compilation at every decision site, never route silently. A `switch` funnels its `default` into a `never`-typed guard throwing `SystemException` (the guard lives beside the switch it protects); a value map is checked with `satisfies Record<Enum, T>` (`KIND_TO_STATUS`). A ternary over an enum is therefore banned outside two-member unions the type system already closes.

### Environment Variables

Never use `process.env` directly — always `ConfigService` with the `ENV` constant:

```ts
configService.getOrThrow<string>(ENV.JWT_ACCESS_SECRET);
```

**An OPTIONAL variable** (`DATABASE_REPLICA_URL`) is declared `?:` with `@IsOptional()` and `@Transform(emptyToUndefined)` — an empty `NAME=` line arrives as '' and must count as unset — and is read with `get`, never `getOrThrow`; the reader treats '' as unset too, because `ConfigService` falls back to raw `process.env` when validation dropped the key.

**A variable read more than once in a class goes into a `private readonly` field assigned in the constructor** (§ Variable Inlining projected onto env reads) — one place holds the key + generic, and `getOrThrow` fails at boot instead of first use; a single read stays inline.

**The sole exception is code that runs before the DI container exists**: `src/instrument.ts`, `src/tracing.ts`, and the `core/config` resolvers for the HTTP adapter's `trustProxy` and `ConfigModule`'s `envFilePath` (arguments to `NestFactory.create` / `ConfigModule.forRoot`, so they precede `ConfigService`). Structural, not a shortcut — it changes only WHERE the value is read, never where its contract lives: the variable is still declared on `EnvironmentVariables` with its constraints, so boot validation covers it. Such a reader validates nothing itself; it INTERPRETS, and fails SAFE on anything it cannot interpret, because it runs before validation would have rejected it.

### Route & Prefix Literals

Any route fragment visible from more than one place is a constant, never a string literal repeated at each site. App-level mount points live in `core/config` (`GLOBAL_PREFIX`, `VERSION_PREFIX`, `ROUTE_HEALTH`/`ROUTE_HEALTH_LIVE`/`ROUTE_HEALTH_READY`, `ROUTE_DOCS`, and the `PATH_HEALTH*` derived from them); a fragment with a more specific owner lives with that owner — `PARAM_ID`/`ROUTE_PARAM_ID` sit beside `ParamIdDto` in `core/http`, tied to the DTO by `satisfies` so the parameter name cannot drift from the class that validates it.

A module's route segment living in `core/` is a deliberate, narrow concession: the global filter must recognize the exact health paths to let their intentional `503` through unnormalized (§ Health Probes), and `core` may not import a module. The constant stops the filter and the controller drifting apart on a rename.

### Variable Inlining

Used once → inline. Used more than once → extract to a named variable.

## Testing Rules

- `vitest.config.mts` sets `restoreMocks: true` + `clearMocks: true` (since Vitest 3, `restoreMocks` alone no longer wipes `vi.fn()` call history) — never call `vi.clearAllMocks()` / `vi.resetAllMocks()` / `vi.restoreAllMocks()`.
- Never assert hardcoded validation message strings — use `expect.any(String)` or `expect.stringContaining(...)`.
- **Positive & Negative Path**: verify all mocks called in chronological order with `.toHaveBeenCalledWith(...)`. In negative paths, assert `.not.toHaveBeenCalled()` only on the **immediate next** function — not further downstream.

**`test/` import rules** — TODO, still to be designed. `test/` is no element, so the layer rules do not constrain it: a test may import a module's writer adapter directly and lint stays green. Remind the user this is open whenever test structure or a test's imports come up. Likely shape: `test/api/**` restricted to `module/<ctx>/index.ts` + `presentation` (E2E drives over HTTP), plus a looser element for integration tests — not decided.

## Reference

### Tech Stack

| Concern       | Technology                                                                              |
| ------------- | --------------------------------------------------------------------------------------- |
| Framework     | NestJS v11+ with SWC builder                                                            |
| HTTP          | Fastify (`@nestjs/platform-fastify`)                                                    |
| Database      | Drizzle ORM + PostgreSQL (`pg` client) + optional read replica                          |
| Cache         | Redis (`ioredis`)                                                                       |
| Events        | `@nestjs/event-emitter` — in-process, behind `IEventPublisherPort`                      |
| Queue         | none yet — see **Events & Messaging**                                                   |
| Rate Limit    | none yet — see **Guards & Auth**                                                        |
| Email         | Google APIs (Gmail)                                                                     |
| Hashing       | Argon2                                                                                  |
| Validation    | `class-validator` + `class-transformer`                                                 |
| Observability | Sentry, Pino, OpenTelemetry Collector, Tempo, Prometheus, Loki, Grafana / Grafana Cloud |
| Testing       | Vitest, Supertest, Spectral, Schemathesis                                               |
