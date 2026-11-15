# Coding Conventions

- Before implementing, inspect analogous code and follow established structure, naming, and style; diverge only when requirements differ.
- Always use braces for control-flow bodies.

## JSDoc

- Use multiline JSDoc. Files start with matching `@file` and `@description`. Classes, interfaces, constructors, methods, functions, and variables/fields declared outside function or method bodies require purpose/rationale JSDoc.
- Separate summaries from tags with an empty ` *` line. Comments explain current rationale briefly; do not add filler, history, or code narration.
- Document every property of named interfaces/types, including nested objects and union variants. Inline parameter types and temporary local types are exempt.
- For inline object parameters, document fields with `@param name.field`, omit the parent `@param name`, and use a descriptive name for destructured parameters. Do not add field JSDoc inside inline parameter types.
- Do not add JSDoc to inline callbacks; when non-obvious callback logic needs explanation, use a brief ordinary comment.
- DI-token JSDoc links to the represented contract, behavior, or client with `{@link ...}`.
- Document expected failures with `@throws {ExceptionType}` on the contract declaration when one exists; do not repeat them in its implementations. If no contract declaration exists, document them on the implementation callable that owns the behavior. Include taxonomy exceptions, health/cleaner failures, and caller-handled library failures; omit universal unexpected errors.
- Document every parameter with `@param` without repeating TypeScript type syntax. Use `@returns` for non-`void` results, including factories; omit it for `void` / `Promise<void>`.

## Types, Signatures & Variables

- Use `interface` for behavior contracts; use `type` for data shapes and type composition.
- Data-shape properties and exposed collection views are `readonly` unless their owner intentionally mutates them.
- Validate external input and invariants, not guarantees already provided by TypeScript for typed internal values.
- Give class members the narrowest visibility: `private` for implementation details, `protected` only for subclass contracts, and public only for consumers/framework contracts. Constructor-only values stay plain parameters; retained dependencies are `private readonly`; retained public command/query data is `readonly`.
- Respect `exactOptionalPropertyTypes`: use `?: X`, never `?: X | undefined`; omit absent keys instead of assigning `undefined`. Check absence explicitly when falsy values are valid. For `unknown`, use an explicit boolean check before spreading. Drizzle update-set column exclusion is the intentional exception (`id: undefined`, `createdAt: undefined`).
- Explicitly type function/method returns except implementation `void` / `Promise<void>`; interface returns are always explicit.
- Exhaust enum/union decisions: switch defaults use a local `never` guard that throws `SystemException`; exhaustive maps use `satisfies Record<Enum, T>`. Use a ternary to branch on an enum/union member only when the discriminant type has exactly two members.
- Used once → inline; reused → named variable, unless each use requires a fresh read.
- Group consecutive local declarations of the same kind (`const` or `let`) into one declaration with comma-separated declarators.
- For diagnostic class names, use `this.constructor.name` for the current instance, `instance.constructor.name` for another instance, and class/function `.name` when no instance exists.

## Environment & Configuration

- Numeric application duration environment values use seconds and convert at library boundaries; string TTLs require explicit `s`/`m`/`h`/`d` suffixes.
- `EnvironmentVariables` owns application environment validation and conversion. Use explicit number/boolean conversion, keep implicit conversion disabled, preserve intentional empty values, match consumer constraints, allow fractional durations where supported, and enforce technical bounds rather than arbitrary capacity caps.
- Keep application environment keys in the same order across `.env` files, `ENV`, and `EnvironmentVariables`.
- Read application configuration through `ConfigService` + `ENV`: typed `getOrThrow` for required values and `get` for optional values. Optional environment fields use `?:` + `@IsOptional()`; when empty means unset, normalize with `@Transform(emptyToUndefined)` and account for raw `''` fallback in pre-validation readers.
- Within a provider, read configuration keys used at multiple code sites once into constructor-initialized `private readonly` fields.
- Direct `process.env` reads are limited to pre-DI instrumentation/tracing and `core/config` env-file/trust-proxy resolution. Interpret them fail-safe without duplicating boot validation.

## Route Constants

- Keep reused route/path fragments with their owner ([Placement & Naming](architecture.md#placement--naming)).
- `core/config` owns application-wide/version/health/docs fragments needed by composition-root and core consumers. Keep route-parameter constants beside the DTO they describe. When a constant names a DTO property, bind it with `satisfies keyof <Dto>` so renaming the property fails at compile time.
