# Coding Conventions

### JSDoc

- Files start with matching `@file` + `@description`; classes/interfaces/methods/functions require purpose/rationale JSDoc.
- Comments explain current rationale briefly; no filler/history/code narration.
- Document contract failures with `@throws {ExceptionType}` at their declaration (interface methods, facades, etc.), not again in implementations: taxonomy, health/cleaner failures and caller-caught library errors, including propagation and async rejection. Omit universal unexpected-error tags.
- Require `@param` for each parameter without TS types, and `@returns` except for `void` / `Promise<void>` (omit it). Describe return meaning, including decorator factories, not raw types.

### Types, Signatures & Variables

- Use `interface` for behavior contracts; `type` for data shapes and type compositions.
- Keep `exactOptionalPropertyTypes`; ban `?: X | undefined`. Omit absent keys via conditional spread, never conditional `undefined`; for `unknown`, use an explicit boolean check (`x !== undefined`) before spreading. Drizzle update-set column exclusion is exempt (`id: undefined`, `createdAt: undefined`).
- Explicitly type all function/method returns except `void` / `Promise<void>`, which implementations infer; interface returns are always explicit.
- Exhaust enum/union decisions: switch defaults call a local `never` guard throwing `SystemException`; maps use `satisfies Record<Enum, T>`. Only ternaries dispatching by enum/union member require closed two-member types.
- Used once → inline; reused → named variable, unless each use requires a fresh read.

### Environment & Route Constants

- Numeric app duration env values use seconds; convert at library boundaries. String TTLs require `s`/`m`/`h`/`d`.
- Keep environment validation in `env.validation.ts`; consumers and conversion utilities must not repeat it.
- Boot-validate app env in `EnvironmentVariables`: explicit number/boolean conversion, no implicit conversion or blank/boolean-to-number coercion. Match consumer formats, choices, integer requirements and bounds; allow fractional durations where supported. Preserve intentional empty values; enforce technical limits, not arbitrary capacity caps.
- Read through `ConfigService` + `ENV`: typed `getOrThrow` for required values, `get` for optional ones. Optional env uses `?:` and `@IsOptional()`; where empty means unset, use `@Transform(emptyToUndefined)` and handle `''` in readers because raw-env fallback may restore it.
- Within a provider, read keys used at multiple code sites once into constructor-initialized `private readonly` fields.
- Direct `process.env` reads are limited to pre-DI instrumentation/tracing and `core/config` trust-proxy/env-file resolvers. Interpret safely without duplicating boot validation.
- Keep reused route fragments with their owner ([Placement & Naming](architecture.md#placement--naming)). `core/config` owns app mounts (`GLOBAL_PREFIX`, `VERSION_PREFIX`, `ROUTE_HEALTH*`, `ROUTE_DOCS`) and derived `PATH_HEALTH*`, allowing health controller/filter agreement without core importing a module. Keep `PARAM_ID` / `ROUTE_PARAM_ID` beside `ParamIdDto`, with the parameter key checked by `satisfies`.
