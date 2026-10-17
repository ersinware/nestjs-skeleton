# Architecture

## Layer Isolation

Read `eslint.config.mjs` before changing file placement or cross-boundary dependencies. Fix design, never bypass rules; update ESLint and this guide together for intentional boundary changes.

ESLint matrix: types from `boundaries/elements`, cross-element permissions from `boundaries/dependencies`; unlisted cross-element imports forbidden. `own` = same captured module; `any` = any module. Entry points/same-concern imports: [Barrels](architecture.md#barrels).

- `shared` → `shared`
- `core`, `coreCqrs`, `bootstrap` → `shared`, `core`
- `moduleShared` → `shared`, own `moduleShared`
- `domain` → `shared`, own `moduleShared`, own `domain`
- `application` → own `moduleShared`, `shared`, `core`, `coreCqrs`, own `domain`, own `application`
- `infrastructure` → own `moduleShared`, `shared`, `core`, own `domain`, own `application`, own `infrastructure`, any `moduleIndex`
- `presentation` → own `moduleShared`, `shared`, `core`, `coreCqrs`, own `application`, own `presentation`
- `facade` → own `moduleShared`, `coreCqrs`, own `application`
- `moduleIndex` → own `facade`, own `module`
- `module` → own `moduleShared`, `shared`, `core`, `coreCqrs`, own `presentation`, own `application`, own `infrastructure`, own `facade`, any `moduleIndex`

- `src/module/<context>/{domain,shared}/` and `src/shared/`: no npm or I/O; Node builtins allowed without I/O. Elsewhere, npm remains subject to architectural constraints.
- `src/module/<context>/application/` uses core contracts (ports/exceptions/types/utils), never adapters or direct DB/cache clients. Barrel access does not guarantee symbol suitability ([Barrels](architecture.md#barrels)).
- Classify all `src/**/*.ts` except composition roots `src/main.ts` and `src/app.module.ts`; none may be imported.
- No unresolved/unclassified dependencies, cycles (including same-layer), or self-imports. No devDependencies in `src/` except `*.spec.ts`.
- In `src/` and `test/`, project imports use absolute `src/` or `test/` paths, never relative. Boundaries cover `src/`; test boundaries: [Testing Rules](testing.md#testing-rules).

## Module Isolation

- Cross-context reads use the owner's read-only facade through a consumer-owned port/adapter ([Layer Isolation](architecture.md#layer-isolation), [CQRS](architecture.md#cqrs)).
- Facades expose queries/read-only prechecks and return flat query read-models, never Drizzle objects, aggregates, or presentation DTOs. Omit facades without cross-context readers.
- Cross-context mutations use durable jobs with owner-defined shared contracts ([Jobs & Messaging](jobs-and-messaging.md#jobs--messaging)).
- No `forwardRef()`; redesign cyclic dependencies.

## Object Storage

- `core/storage` is technical only; owning workflows authorize uploads and select keys, file limits, and cache policies. No standalone upload/signing API.
- Use one S3 client with an endpoint reachable by backend and browser. Never rewrite presigned URLs; sign required upload headers and return them to the client.
- Conditional writes prevent overwrites, not URL reuse after object deletion; never assume presigned URLs are single-use.
- Persist/return object keys; frontend owns CDN URLs and configuration.
- Permanent files are immutable: each replacement uses a new version key; retries retain that key and prevent overwrites. Public delivery uses long-lived immutable caching.
- Storage and database changes are not atomic; reconcile retries and delete sources or previous objects only after the replacement key commits or the delivery is superseded. Persist cleanup identities with the mutation; retries must resume cleanup.
- Soft deletion retains Admin/User avatars. A writer's missing result does not prove physical deletion; orphan reconciliation must protect avatar references on soft-deleted rows.
- Cache metadata does not authorize reads; protected files require access control and caching compatible with access revocation.

## Dependency Injection

- DI tokens use `Symbol()` without arguments, except Redis connection tokens whose distinct descriptions identify connections in outage logs. Port bindings: token in the interface file; consumers `@Inject(TOKEN)`; module `{ provide: TOKEN, useClass: Adapter }`. Share identically configured adapters across ports with `useExisting`.
- Value-parameterized adapters: undecorated classes + `useFactory`.
- Redefined DI constructors must annotate token dependencies with `@Inject` at their new parameter positions, including those forwarded to `super`.
- Register local providers; import modules exporting external providers. No project `@Global()` modules; global `ConfigModule` is the exception. Verify DI wiring separately; ESLint checks import boundaries.

## CQRS

- Commands extend `Command<R>`; return affected id/`void`, except auth token results, workflow-owned upload-initiation plans, and credential-login/password-change/email-confirmation/user-activation session outcomes ([Security & Sessions](security-and-sessions.md#session-versions--failure-semantics)). Mutate aggregates through their methods; pass whole aggregates to write ports ([Adapters](data-and-state.md#adapters)).
- Dispatched queries extend `Query<T>`; queries never mutate business state. Infer dispatch results from queries; explicit return signatures use query-owned read-models, never domain types.
- In `src/module/<context>/application/query/<name>/`, keep results in `query.ts`, outbound contracts in `port.ts`; add `handler.ts` for pipeline dispatch, omit it for direct port reads.
- Outbound query handlers use one purpose-specific local port; compose sources behind it in adapters, even for forwarding/merging ([Adapters](data-and-state.md#adapters)). Static permission catalogs need no outbound port.
- Controllers/facades/listeners/queue consumers/crons dispatch through pipelines, never raw buses or direct handler calls. Exceptions: liveness ([Health Probes](http.md#health-probes)), cache eviction ([Jobs & Messaging](jobs-and-messaging.md#jobs--messaging)).
- Handlers inject ports directly, never pipelines/buses; write decisions must not use cached reads ([Data & State](data-and-state.md#data--state)).
- Payload/result fields and arrays are `readonly`; preserve cache-key/result stability. HTTP mapping: [DTOs & Responses](http.md#dtos--responses).
- Pipelines wrap Nest buses, never override their tokens. `CqrsPipelineModule` re-exports `CqrsModule` for handler registration; behavior order belongs in `src/core/cqrs/module.ts`.
- `TracingBehavior`: outermost on both pipelines; one named span per dispatch, recording errors and rethrowing unchanged ([Exceptions](exceptions.md#exceptions)).
- `QueryCachingBehavior`: query-owned opt-in cache-aside via `ICacheableQuery` (`cacheKey()`, `cacheTtlSeconds`). Cache writes are fire-and-forget; catch unexpected rejections, error-log and capture via observability ports without rethrowing.
- `CacheInvalidationBehavior`: `ICacheInvalidatingCommand` opts into awaited best-effort eviction of `invalidatedKeys()` after handler success ([Jobs & Messaging](jobs-and-messaging.md#jobs--messaging)).

## Project Structure

Only source pillars:

- `src/shared/`: pure shared contracts and abstractions.
- `src/core/`: technical capabilities and wiring; no business/domain logic.
- `src/module/`: bounded contexts, organized by context → layer → role.

Entry files/imports: [Layer Isolation](architecture.md#layer-isolation). Naming/barrels: subsections below.

Module layout; create only needed parts. Omit `domain/` without an owned aggregate:

```text
src/module/<context>/
  index.ts  <context>.module.ts  <context>.facade.ts
  shared/               # module-owned contracts used across its layers
  domain/
    aggregate/  job/
  application/
    command/port/       # ports shared by commands
    command/<name>/     # command.ts, handler.ts; local port.ts if needed
    query/<name>/       # files: architecture.md#cqrs
    queue/  cron/
  infrastructure/
    adapter/  <context>.schema.ts
  presentation/
    controller/  dto/  listener/  decorator/
```

Facade eligibility: [Module Isolation](architecture.md#module-isolation). Listener and queue-consumer placement: [Jobs & Messaging](jobs-and-messaging.md#jobs--messaging).
Test placement: [Testing Rules](testing.md#testing-rules).

### Placement & Naming

Within `src/`, group by ownership and reasons to change, never TS kind. Placement priority:

1. Contract-specific payloads/vocabulary stay in the contract file.
2. Other code stays with its owning concept, not its consumers.
3. Shared vocabulary gets a content-named file at the owning concept root.

- `src/module/<context>/shared/` holds pure enums, data types, and constants shared by that module's layers. Group by concept; keep business behavior in domain and project-wide contracts in `src/shared/`. Access follows [Layer Isolation](#layer-isolation) and [Barrels](#barrels).
- Separate contracts whose meanings/change drivers diverge; merge only when they represent the same concept. Split growing concepts into meaningfully named sub-concepts, never arbitrary file/kind buckets.
- Use singular role folders from the first file: adapter, port, command, query, listener, queue, cron, job, controller, dto, decorator, guard, filter, hook, interceptor, pipe.
- Keep module/facade/schema files flat; module schemas: `infrastructure/<context>.schema.ts`. Identify data sources in filenames, not folders ([Adapters](data-and-state.md#adapters)).
- Use kebab-case names and dot-separated suffixes. Concept/use-case names may be plural when meaningful; role folders remain singular.
- No kind/generic buckets or bare filenames (`type`, `enum`, `constant`, `util`, `interface`, `class`, `payload`, `common`, `shared`, `helper`, `misc`); never nest pillar names (`shared`, `core`, `module`) below source pillars. The sole exception is `src/module/<context>/shared/`.
- Content-named files may use kind suffixes when independently justified by ownership. Prefer architectural roles over implementation kinds: `.adapter.ts`, never `.class.ts`.
- A role file directly inside its concept uses the bare role (`command.ts`, `handler.ts`, `port.ts`, `module.ts`); inside a role folder, include its subject (`adapter/user-reader.adapter.ts`, never `adapter/adapter.ts`).

### Barrels

- Place `index.ts` only at module roots or the deepest independently consumed core/shared concern roots; never in grouping folders, layers, roles, or use cases. No stacked barrels.
- In `src/`, enter another core/shared concern or module through its root barrel. Direct imports within the same concern/module remain subject to [Layer Isolation](architecture.md#layer-isolation); tests: [Testing Rules](testing.md#testing-rules).
- Use explicit named exports, never `export *`; expose only public API needed by existing or explicitly approved consumers. Module barrels expose only their Module and optional Facade.
- Keep internal adapters, behavior classes, and private connection tokens unexported. Public contracts may come from implementation files; public DB client tokens remain infrastructure contracts ([Layer Isolation](architecture.md#layer-isolation)).
- Align core/shared barrel roots with ESLint elements; grouping-folder wildcards may already cover additions. `eslint.config.spec.ts` verifies pattern alignment and required barrels.
