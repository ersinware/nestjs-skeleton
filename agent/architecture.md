# Architecture

## Layer Isolation

- `eslint.config.mjs` is the executable source of truth for import permissions and boundary entry points. Read it before changing placement or cross-boundary dependencies; change ESLint and this guide together for intentional architecture changes. Never bypass the rules.
- Boundary access is deny-by-default. A barrel export does not imply a layer may import that symbol.
- `src/shared/` and `src/module/<context>/{domain,shared}/` are pure TypeScript: no npm packages or I/O; Node built-ins are allowed only without I/O. Application code uses contracts, never adapters or direct database/cache clients.
- Classify every `src/**/*.ts` file except the composition roots `src/main.ts` and `src/app.module.ts`; composition roots may wire the application but must not be imported.
- No unresolved or unclassified dependencies, cycles (including same-layer), self-imports, or production imports from devDependencies; co-located `*.spec.ts` files are exempt from the devDependency rule.
- Project imports in `src/` and `test/` use absolute `src/` or `test/` paths, never relative imports. `test/` boundary enforcement remains defined in [Testing Rules](testing.md#testing-rules).

## Module Isolation

- Cross-context reads use the owner's read-only facade through a consumer-owned port/adapter. Facades expose queries or read-only prechecks and return flat query read-models, never aggregates, Drizzle objects, or presentation DTOs. Omit facades without cross-context readers.
- Cross-context mutations use durable jobs with owner-defined shared contracts ([Jobs & Messaging](jobs-and-messaging.md#jobs--messaging)).
- Do not use `forwardRef()`; redesign cyclic dependencies.

## Dependency Injection

- DI tokens use `Symbol()` without arguments; Redis connection tokens may use descriptions to distinguish connections in outage logs. Bind tokens with their owning contracts; consumers use `@Inject(TOKEN)`.
- Share one configured adapter across multiple ports with `useExisting`. Value-parameterized adapters are undecorated classes created with `useFactory`.
- Register local providers locally and import modules for exported providers. Do not add project `@Global()` modules; global `ConfigModule` is the exception. ESLint validates imports, not DI wiring.

## CQRS

- Commands extend `Command<R>` and normally return the affected id or `void`; auth token results, workflow-owned upload-initiation plans, and credential-login outcomes are explicit exceptions ([Security & Sessions](security-and-sessions.md#session-versions--failure-semantics)). Mutate aggregates through aggregate methods and pass whole aggregates to write ports ([Adapters](data-and-state.md#adapters)).
- Dispatched queries extend `Query<T>` and never mutate business state. Keep query result types in `query.ts`; outbound contracts in `port.ts`. Add `handler.ts` only for pipeline-dispatched queries. Outbound query handlers use one purpose-specific local port; adapters compose sources behind it.
- Controllers, facades, listeners, consumers, and crons dispatch application commands/queries through pipelines, never raw buses or direct handlers. Liveness performs no dispatch; durable cache-eviction consumers may call `ICacheEvictionPort` directly ([Jobs & Messaging](jobs-and-messaging.md#jobs--messaging)). Handlers inject ports directly, never pipelines/buses; write decisions must not use cached reads.
- Payload/result fields and arrays are `readonly`; preserve cache-key and result stability. HTTP mapping belongs at the HTTP edge ([DTOs & Responses](http.md#dtos--responses)).
- Pipelines wrap Nest buses and never replace their tokens. `CqrsPipelineModule` re-exports `CqrsModule`; behavior order belongs in `src/core/cqrs/module.ts`.
- `TracingBehavior` is outermost on both pipelines and rethrows recorded errors unchanged. `QueryCachingBehavior` is query-owned opt-in cache-aside; cache writes are fire-and-forget and unexpected failures are reported without failing the query. `CacheInvalidationBehavior` performs awaited best-effort eviction after command success; participating commands also persist durable invalidation jobs with cache-affecting mutations ([Jobs & Messaging](jobs-and-messaging.md#jobs--messaging)).

## Project Structure

The source architecture has three pillars; root composition/bootstrap files are explicit exceptions:

- `src/shared/`: pure shared contracts and abstractions.
- `src/core/`: technical capabilities and wiring; no business/domain logic.
- `src/module/`: bounded contexts organized by context → layer → role.

Create only needed module parts; omit `domain/` when the context owns no aggregate.

```text
src/module/<context>/
  index.ts  <context>.module.ts  [<context>.facade.ts]
  shared/
  domain/
    aggregate/  job/
  application/
    command/port/
    command/<name>/
    query/<name>/
    consumer/  cron/
  infrastructure/
    adapter/  <context>.schema.ts
  presentation/
    controller/  dto/  listener/  decorator/
```

Facade eligibility: [Module Isolation](#module-isolation). Listener/consumer placement: [Jobs & Messaging](jobs-and-messaging.md#jobs--messaging). Test placement: [Testing Rules](testing.md#testing-rules).

### Placement & Naming

- Place code by ownership and reason to change, not TypeScript kind: contract-specific vocabulary stays with the contract; other code stays with its owning concept; genuinely shared vocabulary gets a content-named file at the owning concept root.
- `src/module/<context>/shared/` contains pure module-owned enums, data types, and constants shared across its layers. Keep business behavior in domain and project-wide contracts in `src/shared/`.
- Split contracts/concepts when meanings or change drivers diverge; merge only when they represent the same concept. Never split into arbitrary kind/file-size buckets.
- Use singular role folders from the first file: `adapter`, `port`, `command`, `query`, `listener`, `consumer`, `cron`, `job`, `controller`, `dto`, `decorator`, `guard`, `filter`, `hook`, `interceptor`, `pipe`. Keep module, facade, and schema files flat; identify data sources in filenames, not folders ([Adapters](data-and-state.md#adapters)).
- Use kebab-case names and dot-separated role suffixes. A role file directly inside its concept uses the bare role (`command.ts`, `handler.ts`, `port.ts`); inside a role folder include the subject (`adapter/user-reader.adapter.ts`). Job consumers use `.consumer.ts` / `Consumer`; queue identities keep queue terminology.
- Do not create generic/kind buckets or bare files such as `type`, `enum`, `constant`, `util`, `interface`, `class`, `payload`, `common`, `shared`, `helper`, or `misc`. Do not nest source-pillar names below the pillars; `src/module/<context>/shared/` is the intentional exception. Content-named files may use kind suffixes only when ownership justifies them.

### Barrels

- Put `index.ts` only at module roots or the deepest independently consumed core/shared concern roots; never in grouping folders, layers, roles, or use cases. Do not stack barrels.
- Enter another module or core/shared concern through its root barrel. Direct imports inside the same concern/module remain subject to [Layer Isolation](#layer-isolation); tests follow [Testing Rules](testing.md#testing-rules).
- Use explicit named exports, never `export *`, and expose only API required by existing or explicitly approved consumers. Module barrels expose only their Module and optional Facade.
- Keep internal adapters, behavior classes, and private connection tokens unexported. Preserve explicitly required public implementation contracts such as `JwtTokenAdapter` and public database client tokens. `eslint.config.spec.ts` keeps core/shared barrel roots aligned with ESLint elements.
