# Coding Conventions

- Before implementing, inspect analogous code and follow its structure, naming, and style; diverge only when requirements differ.

### Blocks

- Always use braces for control-flow bodies.

### JSDoc

- Use multiline JSDoc (`/**`, ` * ...`, ` */` on separate lines); separate the summary from tags with an empty ` *` line.
- Files start with matching `@file` + `@description`; classes/interfaces/methods/functions and variables or fields declared outside function/method bodies require purpose/rationale JSDoc.
- Every property in an interface or type, including nested objects and union variants, requires JSDoc.
- Comments explain current rationale briefly; no filler/history/code narration.
- DI token JSDoc links to its represented contract, behavior, or client with `{@link ...}`.
- Document contract failures with `@throws {ExceptionType}` at their declaration (interface methods, facades, etc.), not again in implementations: taxonomy, health/cleaner failures and caller-caught library errors, including propagation and async rejection. Omit universal unexpected-error tags.
- Require `@param` for each parameter without TS types, and `@returns` except for `void` / `Promise<void>` (omit it). Describe return meaning, including decorator factories, not raw types.

### Types, Signatures & Variables

- Use `interface` for behavior contracts; `type` for data shapes and type compositions.
- Data-shape properties and exposed collection views are `readonly` unless their owner deliberately mutates them.
- Do not repeat TypeScript guarantees as runtime checks for typed internal values; validate external input and invariants not enforced by types.
- Give class members the narrowest visibility: `private` for implementation details, `protected` only for subclass contracts, and public only for consumers or framework contracts. A parameter used only while the constructor runs remains a plain parameter; retained dependencies are `private readonly`, while retained public command/query data is `readonly`.
- Keep `exactOptionalPropertyTypes`; ban `?: X | undefined`. Omit absent keys via conditional spread, never conditional `undefined`. Test absence explicitly when valid values can be falsy; truthy checks are for enabled/non-empty semantics. For `unknown`, use an explicit boolean check before spreading. Drizzle update-set column exclusion is exempt (`id: undefined`, `createdAt: undefined`).
- Explicitly type all function/method returns except `void` / `Promise<void>`, which implementations infer; interface returns are always explicit.
- Exhaust enum/union decisions: switch defaults call a local `never` guard throwing `SystemException`; maps use `satisfies Record<Enum, T>`. Only ternaries dispatching by enum/union member require closed two-member types.
- Used once → inline; reused → named variable, unless each use requires a fresh read.

### Environment & Route Constants

- Numeric app duration env values use seconds; convert at library boundaries. String TTLs require `s`/`m`/`h`/`d`.
- Keep environment validation in `env.validation.ts`; consumers and conversion utilities must not repeat it.
- Keep shared keys in the same order across application `.env` files, `ENV`, and `EnvironmentVariables`.
- Boot-validate app env in `EnvironmentVariables`: explicit number/boolean conversion, no implicit conversion or blank/boolean-to-number coercion. Match consumer formats, choices, integer requirements and bounds; allow fractional durations where supported. Preserve intentional empty values; enforce technical limits, not arbitrary capacity caps.
- Read through `ConfigService` + `ENV`: typed `getOrThrow` for required values, `get` for optional ones. Optional env uses `?:` and `@IsOptional()`; where empty means unset, use `@Transform(emptyToUndefined)` and handle `''` in readers because raw-env fallback may restore it.
- Within a provider, read keys used at multiple code sites once into constructor-initialized `private readonly` fields.
- Direct `process.env` reads are limited to pre-DI instrumentation/tracing and `core/config` trust-proxy/env-file resolvers. Interpret safely without duplicating boot validation.
- Keep reused route fragments with their owner ([Placement & Naming](architecture.md#placement--naming)). `core/config` owns app mounts (`GLOBAL_PREFIX`, `VERSION_PREFIX`, `ROUTE_HEALTH*`, `ROUTE_DOCS`) and derived `PATH_HEALTH*`, allowing health controller/filter agreement without core importing a module. Keep `PARAM_ID` / `ROUTE_PARAM_ID` beside `ParamIdDto`, with the parameter key checked by `satisfies`.
