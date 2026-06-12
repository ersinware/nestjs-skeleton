---
trigger: always_on
---

# Antigravity Project Context: NestJS Skeleton (The Standard)

## Core Mission

This project is a high-performance, production-ready NestJS skeleton designed for engineering excellence. It serves as the foundation for all future projects. Every line of code must adhere to the highest standards of software design, maintainability, and scalability.

## Architecture & Tech Stack

- **Framework:** NestJS (v11+) with **Fastify** (not Express) for maximum request throughput.
- **ORM:** **Drizzle ORM** for type-safe, lightweight database interactions.
- **API Engine:** REST with mandatory **API Versioning** (e.g., `src/v1/`).
- **Security:** **Argon2** for ultra-secure password hashing and verification.
- **Documentation:** **Scalar** & **Swagger**. Every endpoint MUST have complete OpenAPI decorators.
- **Validation:** Strict `class-validator` and `class-transformer` usage in DTOs.
- **Infrastructure:** Docker-first approach, GitHub Actions for CI/CD, Husky for Git hooks.

## Engineering Principles (Strictly Enforced)

### 1. SOLID & Clean Architecture

Maintain strict separation of concerns. Controllers handle transport layer validation and execution context, Services coordinate business logic, Repositories handle database queries, and DTOs define data contracts.

### 2. Repository Pattern Abstraction

Never inject Drizzle ORM directly into Services. Always decouple business logic from database access by providing a repository interface in the `interface/` directory and its implementation in the `repository/` directory. Inject repositories using custom Symbol Injection Tokens defined in `constant/`.

### 3. Strict Singular Folder Structure

Module directories must always use singular naming conventions: `dto/`, `interface/`, `repository/`, `type/`, `constant/`. Never use plural directories (such as `dtos/`, `interfaces/`, `repositories/`, `types/`, `constants/`).

### 4. Type Safety

Do not use `any`. Write strict, fully annotated TypeScript. Leverage Drizzle's type inference to match database schema outputs accurately.

### 5. Bulletproof Response Security & Data Whitelisting

To prevent accidental data leaks (like password hashes or internal database keys) after TypeScript types are stripped at runtime, all response DTOs (e.g., `GetUserDto`) MUST use `class-transformer`'s `@Exclude()` at the class level and `@Expose()` at the property level to enforce a strict whitelist approach.

### 6. HTTP-Method REST DTO Naming

- Standard DTO files and classes representing request bodies must be prefixed with the HTTP method: `[http-method]-[schema-name].dto.ts` (e.g., `post-user.dto.ts` $\rightarrow$ `PostUserDto`, `patch-user.dto.ts` $\rightarrow$ `PatchUserDto`).
- Query parameter DTO files and classes (used for GET/DELETE request query params/search/pagination) must be prefixed with `query-`: `query-[schema-name]-[action].dto.ts` or `query-[type].dto.ts` (e.g., `query-user-search.dto.ts` $\rightarrow$ `QueryUserSearchDto`, `query-pagination.dto.ts` $\rightarrow$ `QueryPaginationDto`).
- Custom actions or sub-resources representing request bodies append the action: `[http-method]-[schema-name]-[action].dto.ts` (e.g., `patch-user-password.dto.ts` $\rightarrow$ `PatchUserPasswordDto`).
- Global/Common DTOs must use prefix classification: `error-[type].dto.ts` (e.g., `error-default.dto.ts`) and `response-[type].dto.ts`.

### 7. Documentation-Driven Development

API contracts must be valid and descriptive. All DTO classes must include `@ApiSchema({ name: '...' })` matching the class name without the "Dto" suffix. Use custom decorators prefixed with `ApiDefault` (e.g. `ApiDefaultBadRequestResponse`) where available to prevent redundancy.

### 8. Strict Variable Inlining & Retention

- If a value, function call, or expression is used in **multiple places (more than once)**, it **MUST** be defined as a variable to prevent duplicate evaluations and redundant function executions.
- If a value, function call, or expression is used in **exactly one place (only once)**, it **MUST** be inlined directly to reduce cognitive overhead, unless inlining severely harms code legibility.

### 9. Environment Variable Management

Never access `process.env` directly inside modules, controllers, services, or DTOs. Always utilize NestJS's standard `@nestjs/config` `ConfigService` to retrieve environment variables. Declare and validate all environment variables inside `env.validation.config.ts` using `class-validator` and `class-transformer` to ensure application-wide type safety and fail-fast startup behavior. When passing environment variable key names to `ConfigService.getOrThrow()` or `ConfigService.get()`, always use the type-safe `ENV` constant exported from `src/common/config/constant/env.constant.ts` (e.g., `configService.getOrThrow<string>(ENV.JWT_ACCESS_SECRET)`) instead of hardcoded string literals. This `ENV` object uses `as const satisfies Record<keyof EnvironmentVariables, string>` to enforce compile-time parity with the validation class — if a property is added, removed, or renamed in `EnvironmentVariables`, the `ENV` object must be updated accordingly or the build will fail.

### 10. Cloud-Native & Stateless Design (Horizontal Scalability)

The application must be fully stateless to support running multiple concurrent instances behind a load balancer. Never store application state, session data, or uploaded files in local memory or the local container filesystem. Use Redis for caching, rate-limiting, and session tracking.

### 11. Distributed Task & Event Coordination

To prevent double-execution of background tasks across multiple concurrent application instances, coordinate all scheduled crons, background jobs, and event handlers using distributed locking (e.g. Redlock) or distributed message queues (e.g. NestJS BullMQ backed by Redis).

### 12. Observability & Orchestration Probes

Design specifically for Kubernetes or AWS ECS orchestration. Logs must be written exclusively to standard output (`stdout`/`stderr`) in a structured format (JSON). Health check endpoints must expose distinct liveness and readiness indicators to prevent routing traffic to unready containers.

### 13. Return Type Annotations Rule

- In interfaces, always specify the return type for all methods (use `Promise<void>` or `void` explicitly).
- In class implementations (services, repositories, cleaners, indicators, etc.), do NOT specify the return type if it is `Promise<void>` or `void`. Specify non-void return types explicitly.

### 14. JSDoc Documentation Standards

All exported classes, methods, interfaces, and functions must have clear, concise JSDoc comments describing "why" they exist.

- `@param` tags must be documented for all parameters. They must NOT contain TypeScript types (e.g., use `@param name Description` instead of `@param {string} name Description`).
- `@throws` tags must have the exception type wrapped in curly braces (e.g., `@throws {ForbiddenException} if check fails`).
- Methods returning `void` or `Promise<void>` in class implementations must NOT have `@returns` tags.
- Decorator functions returning a decorator should describe the value representation (e.g., `@returns A decorator that validates...`) instead of naming raw types (e.g., `@returns PropertyDecorator`).

### 15. Resilient Rate Limiting (Fail-Open)

The rate-limiting layer implemented via `FailSafeThrottlerGuard` must be resilient.

- If the Redis cache instance becomes unreachable, the guard must catch the storage connection error, log it, and allow the request through (fail open) rather than rejecting user traffic.
- Rate limiting must be automatically bypassed when `NODE_ENV=test` to ensure E2E and fuzz testing suites run without interference.

### 16. Resilient Test Assertions

To prevent copy or message updates from breaking unrelated tests:

- Avoid asserting hardcoded validation message strings or exception messages in tests.
- Use type checks (`typeof message === 'string'`) or generic matchers (`expect.any(String)`, `expect.stringContaining(...)`) instead.

### 17. Vitest Mocking Configuration

The global testing configuration in `vitest.config.mts` has `restoreMocks: true` enabled by default. Do not manually call cleanup/clear/reset/restore functions (like `vi.clearAllMocks()`) in individual test suites.

### 18. Unit Test Execution Verification & Negative Path Assertions (Single-Depth Rule)

To ensure comprehensive test fidelity, correct execution order, and clean negative pathways:

- **Positive & Negative Paths**: Verify that all mock functions expected to be executed within the tested path are explicitly checked for invocation (using `.toHaveBeenCalled()` or `.toHaveBeenCalledWith(...)`) in their exact chronological order of execution. No expected call should be left unverified.
- **Negative Path Single-Depth Assertions**: In negative path tests (where an exception or error is expected to be thrown), only assert that the **very next expected function/method call** in the execution flow was not called using `.not.toHaveBeenCalled()`. Do NOT add redundant `.not.toHaveBeenCalled()` checks for subsequent functions/methods beyond this immediate next function call.

## AI Behavior Instructions

- **Don't Skip Steps:** Never provide "placeholder" logic. Provide complete, production-ready implementations.
- **Be Opinionated:** If a request contradicts "Best Practices" or "NestJS Standards," warn the user and suggest the superior architectural approach.
- **Testing by Default:** When generating a service or controller, always include the corresponding spec/test file.
- **Documentation First:** When creating a controller, always include `@ApiTags`, `@ApiOperation`, and `@ApiResponse` decorators.
- **No Automatic Verification/Testing Runs:** Do NOT automatically run tests (`npm run test`), linting (`npm run lint`), or formatting checks after making code changes. The user will run them manually when needed.
- **Maintain Project Summary:** When new features or architecture changes are introduced, keep the project summary file at `.agents/project-summary.md` updated. Refer to that file as the living source of truth for the codebase details.
- **Check for Custom Decorators First:** When adding Swagger decorators to controllers or endpoints, always check if there is an appropriate custom decorator prefixed with `ApiDefault` (e.g. `ApiDefaultInternalServerErrorResponse`, `ApiDefaultBadRequestResponse`) available in the project to maintain documentation consistency and prevent redundancy.
