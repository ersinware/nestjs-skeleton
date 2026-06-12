# Project Summary & Context

This file serves as the living source of truth for the **NestJS Skeleton (The Standard)** project. It details the architecture, tech stack, codebase structure, database schemas, and active modules for any AI agent interacting with the repository.

## 🚀 Project Overview & Purpose

A high-performance, production-ready NestJS skeleton designed for horizontal scalability, cloud-native observability, and clean architecture.

- **Fastify-first**: Employs Fastify instead of Express for maximum request throughput.
- **Strict Clean Architecture**: SOLID principles, strict separation of concerns, and Repository pattern abstractions are enforced.

## 🛠️ Architecture & Tech Stack

- **Framework**: NestJS (v11+)
- **HTTP Platform**: Fastify (`@nestjs/platform-fastify`)
- **Database / ORM**: Drizzle ORM with PostgreSQL driver (`postgres` client)
- **Caching & Rate Limiting**: Redis (`ioredis`, `@nest-lab/throttler-storage-redis`)
- **Queue & Background Jobs**: BullMQ (`@nestjs/bullmq`, `bullmq`)
- **Email Delivery**: Google APIs (`googleapis` for Gmail API OAuth2 integration)
- **API Documentation**: Swagger and Scalar (`@scalar/nestjs-api-reference`)
- **Password Hashing**: Argon2
- **Validation / Transformation**: `class-validator` and `class-transformer`
- **Testing**: Vitest, Supertest, Spectral (OpenAPI linting), Schemathesis (API contract testing)

## 📁 Codebase Directory Structure

```
nestjs-skeleton/
├── .agents/                            # Agent-specific rules and configurations
│   ├── rules/
│   │   └── nestjs-skeleton.md          # Core rules and behaviors for AI agents
│   └── project-summary.md              # This file (Project Summary & Context)
├── drizzle/                            # Database migrations and Drizzle schemas
├── src/
│   ├── app.module.ts                   # App root module (config, throttler, pipes, filters)
│   ├── main.ts                         # Application bootstrap entry point
│   ├── common/                         # Shared utilities, filters, decorators, and configurations
│   │   ├── config/                     # Config validation schemas
│   │   │   ├── constant/
│   │   │   │   └── env.constant.ts    # Type-safe ENV key map (satisfies EnvironmentVariables)
│   │   │   ├── env.validation.config.ts  # Env validation logic
│   │   │   ├── documentation.config.ts   # Swagger/Scalar OpenAPI configs
│   │   │   └── type/
│   │   │       └── config.type.ts      # Shared configuration types
│   │   ├── constant/                   # Project-wide common constants
│   │   │   └── pagination.constant.ts  # Default pagination offset and limit constants
│   │   ├── dto/                        # Project-wide common DTOs
│   │   │   ├── error-default.dto.ts    # Centralized validation and execution error DTO
│   │   │   ├── param-id.dto.ts         # Path parameter UUID validator DTO
│   │   │   ├── query-pagination.dto.ts # Pagination search query validator DTO
│   │   │   └── response-pagination.dto.ts # Paginated response envelope wrapper DTO
│   │   ├── hashing/                    # Hashing & password verification services
│   │   │   ├── service/
│   │   │   │   ├── hashing.service.ts  # Argon2 password hashing wrapper
│   │   │   │   └── hashing.service.spec.ts # Hashing service unit tests
│   │   │   └── hashing.module.ts       # Global hashing utilities module
│   │   ├── decorator/                  # Common decorators
│   │   │   ├── auth/                   # Authentication & authorization decorators
│   │   │   │   ├── access-token-payload.decorator.ts
│   │   │   │   ├── public.decorator.ts
│   │   │   │   └── roles.decorator.ts
│   │   │   ├── doc/                    # OpenAPI / Scalar response decorators
│   │   │   │   ├── api-default-bad-request-response.decorator.ts
│   │   │   │   ├── api-default-conflict-response.decorator.ts
│   │   │   │   ├── api-default-forbidden-response.decorator.ts
│   │   │   │   ├── api-default-internal-server-error-response.decorator.ts
│   │   │   │   ├── api-default-not-found-response.decorator.ts
│   │   │   │   ├── api-default-ok-response-paginated.decorator.spec.ts
│   │   │   │   ├── api-default-ok-response-paginated.decorator.ts
│   │   │   │   ├── api-default-service-unavailable-response.decorator.ts
│   │   │   │   └── api-default-unauthorized-response.decorator.ts
│   │   │   └── validator/              # Custom field validation decorators
│   │   │       ├── email.decorator.ts
│   │   │       ├── entity-id.decorator.ts
│   │   │       ├── name.decorator.spec.ts
│   │   │       ├── name.decorator.ts
│   │   │       ├── password.decorator.spec.ts
│   │   │       └── password.decorator.ts
│   │   ├── enum/                       # Centralized project-wide enums
│   │   │   ├── auth/                   # Authentication and authorization enums
│   │   │   │   ├── auth-token-type.enum.ts
│   │   │   │   └── auth-user-role.enum.ts
│   │   │   └── error/                  # Error messaging and validation target enums
│   │   │       ├── bad-request-type.enum.ts
│   │   │       ├── conflict-type.enum.ts
│   │   │       ├── forbidden-type.enum.ts
│   │   │       ├── internal-server-error-type.enum.ts
│   │   │       ├── not-found-type.enum.ts
│   │   │       ├── service-unavailable-type.enum.ts
│   │   │       └── unauthorized-type.enum.ts
│   │   ├── filter/                     # Exception filters
│   │   │   ├── global-exception.filter.ts
│   │   │   └── global-exception.filter.spec.ts
│   │   ├── guard/                      # Custom guards
│   │   │   ├── fail-safe-throttler.guard.ts # Fail-open throttler guard
│   │   │   ├── fail-safe-throttler.guard.spec.ts
│   │   │   ├── auth.guard.ts           # JWT authenticator
│   │   │   ├── auth.guard.spec.ts
│   │   │   ├── auth-roles.guard.ts     # RBAC evaluator
│   │   │   ├── auth-roles.guard.spec.ts
│   │   │   └── interface/
│   │   │       └── auth.interface.ts   # JWT request extension and token payload interfaces
│   │   ├── interceptor/                # Global response formatters
│   │   │   ├── response.interceptor.ts
│   │   │   └── response.interceptor.spec.ts
│   │   ├── pipe/                       # Validation pipes
│   │   │   ├── not-empty-body.pipe.ts
│   │   │   └── not-empty-body.pipe.spec.ts
│   │   └── util/                       # Helper utilities
│   │       ├── password-generator.util.spec.ts
│   │       ├── password-generator.util.ts
│   │       └── swagger.util.ts         # Swagger document builder & envelope wrapper
│   ├── database/                       # DatabaseModule & Drizzle client initialization
│   │   ├── constant/
│   │   │   └── database.constant.ts    # Database module injection tokens (TOKEN_DATABASE, etc.)
│   │   ├── database.module.ts          # Postgres pool setup and Drizzle registration
│   │   ├── interface/                  # Database interfaces
│   │   │   ├── database-cleaner.interface.ts
│   │   │   └── database-health-indicator.interface.ts
│   │   ├── service/                    # Database services
│   │   │   ├── postgres-cleaner.service.ts
│   │   │   ├── postgres-cleaner.service.spec.ts
│   │   │   ├── postgres-health.indicator.ts
│   │   │   └── postgres-health.indicator.spec.ts
│   │   └── schema/                     # Drizzle ORM database schema definitions
│   │       ├── index.ts                # Consolidated schema exporter
│   │       ├── base.schema.ts          # Base fields (timestamps helper)
│   │       ├── users/
│   │       │   ├── users.schema.ts     # Users table structure
│   │       │   └── users.relations.ts  # Users relationships definitions
│   │       └── admins/
│   │           └── admins.schema.ts    # Admins table structure
│   ├── cache/                          # CacheModule & Redis Client initialization (Split Cache/State)
│   │   ├── constant/
│   │   │   └── cache.constant.ts       # Cache module constants and split injection tokens
│   │   ├── cache.module.ts             # Cache and State connections and graceful shutdowns
│   │   ├── interface/                  # Cache interfaces
│   │   │   ├── cache-service.interface.ts
│   │   │   ├── cache-state-service.interface.ts
│   │   │   ├── cache-cleaner-service.interface.ts
│   │   │   └── cache-health-indicator.interface.ts
│   │   ├── service/                    # Cache & State services
│   │   │   ├── redis.service.ts        # Generic RedisService implementation (cache client)
│   │   │   ├── redis.service.spec.ts   # Caching operations unit tests
│   │   │   ├── redis-state.service.ts  # Specialized RedisStateService class using State client
│   │   │   ├── redis-state.service.spec.ts # Session state unit tests
│   │   │   ├── redis-cleaner.service.ts # Redis database flusher (flushes both cache and state)
│   │   │   ├── redis-cleaner.service.spec.ts # Redis database flusher unit tests
│   │   │   ├── redis-health.indicator.ts # Redis connectivity probe (pings both cache and state)
│   │   │   └── redis-health.indicator.spec.ts # Redis connectivity probe unit tests
│   │   └── util/                       # Cache helper utilities
│   │       └── cache-key.util.ts       # Centralized cache key builder utility
│   ├── email/                          # Email background processing module
│   │   ├── constant/
│   │   │   └── email.constant.ts       # Dependency injection tokens
│   │   ├── interface/
│   │   │   └── email.service.interface.ts # E-mail service contract interface
│   │   ├── type/
│   │   │   └── email.type.ts           # Email job payload definitions
│   │   ├── service/
│   │   │   ├── email.service.ts        # BullMQ job scheduler implementation
│   │   │   ├── email.service.spec.ts   # Unit tests
│   │   │   └── gmail.service.ts        # Google Gmail API implementation
│   │   ├── processor/
│   │   │   ├── email.processor.ts      # BullMQ background job worker
│   │   │   └── email.processor.spec.ts # Unit tests
│   │   └── email.module.ts             # Module configuration
│   ├── health/                         # Health check probes (Liveness / Readiness)
│   │   ├── dto/
│   │   │   ├── healthy.dto.ts
│   │   │   └── unhealthy.dto.ts
│   │   ├── util/
│   │   │   └── dto.util.ts
│   │   ├── health.controller.ts
│   │   ├── health.controller.spec.ts
│   │   ├── health.service.ts
│   │   ├── health.service.spec.ts
│   │   └── health.module.ts
│   ├── script/                         # CLI utilities
│   │   └── build-swagger.ts            # Statically exports OpenAPI spec & Scalar templates
│   └── v1/                             # Version 1 API modules
│       ├── admin/                      # Admin repository and module
│       │   ├── constant/
│       │   │   └── admin.constant.ts   # Admin injection tokens
│       │   ├── dto/
│       │   │   ├── get-admin.dto.ts
│       │   │   ├── get-created-admin.dto.ts
│       │   │   ├── post-admin.dto.ts
│       │   │   └── patch-admin-status.dto.ts
│       │   ├── interface/              # Admins repository interface
│       │   │   └── admins.repository.interface.ts
│       │   ├── repository/             # Admins repository using Drizzle
│       │   │   └── admins.repository.ts
│       │   ├── type/
│       │   │   └── admin.type.ts
│       │   ├── admin.controller.ts
│       │   ├── admin.controller.spec.ts # Admin controller unit tests
│       │   ├── admin.service.ts
│       │   ├── admin.service.spec.ts
│       │   └── admin.module.ts
│       ├── auth/                       # Authentication & Session module
│       │   ├── constant/
│       │   │   └── auth.constant.ts    # Token lengths and authentication constants
│       │   ├── decorator/
│       │   │   └── refresh-token.decorator.ts
│       │   ├── dto/
│       │   │   ├── post-auth-login.dto.ts
│       │   │   ├── post-auth-refresh.dto.ts
│       │   │   └── get-auth-tokens.dto.ts
│       │   ├── auth.controller.ts
│       │   ├── auth.controller.spec.ts
│       │   ├── auth.service.ts
│       │   ├── auth.service.spec.ts
│       │   ├── token.service.ts            # JWT token service
│       │   ├── token.service.spec.ts
│       │   ├── session.service.ts          # Redis session service
│       │   ├── session.service.spec.ts
│       │   └── auth.module.ts
│       └── user/                       # User resource module
│           ├── constant/
│           │   └── user.constant.ts    # User injection tokens
│           ├── dto/
│           │   ├── get-user.dto.ts
│           │   ├── post-user.dto.ts
│           │   ├── patch-user.dto.ts
│           │   ├── patch-user-password.dto.ts
│           │   ├── patch-user-status.dto.ts
│           │   └── query-user-search.dto.ts
│           ├── interface/              # Users repository interface
│           │   └── users.repository.interface.ts
│           ├── repository/             # Users repository using Drizzle
│           │   └── users.repository.ts
│           ├── type/
│           │   └── user.type.ts
│           ├── user.controller.ts
│           ├── user.controller.spec.ts
│           ├── user.service.ts
│           ├── user.service.spec.ts
│           └── user.module.ts
└── test/                               # E2E test suites
    ├── api/                            # API / Business Controller E2E Tests
    │   └── v1/
    │       ├── admin/
    │       │   └── admin.e2e-spec.ts   # Admin E2E tests
    │       ├── auth/
    │       │   └── auth.e2e-spec.ts    # Authentication & Session rotation E2E tests
    │       ├── user/
    │       │   └── user.e2e-spec.ts    # User CRUD API E2E tests
    │       └── health/
    │           └── health.e2e-spec.ts  # Health check probe E2E tests
    ├── core/                           # Infrastructure & Global Framework E2E Tests
    │   ├── auth-guard/
    │   │   ├── auth.guard.e2e-spec.ts  # Auth guard routing, JWT and blocklist protection E2E tests
    │   │   └── auth.guard.fixture.ts   # Mock controller & app factory for AuthGuard tests
    │   ├── fail-safe-throttler-guard/
    │   │   ├── fail-safe-throttler.guard.e2e-spec.ts # Throttler guard resilience tests
    │   │   └── fail-safe-throttler.guard.fixture.ts # Mock config & app factory for Throttler tests
    │   ├── global-exception-filter/
    │   │   ├── global-exception.filter.e2e-spec.ts # Exception Filter branch tests
    │   │   └── global-exception.filter.fixture.ts # Error-throwing controllers for exception filter tests
    │   └── response-interceptor/
    │       ├── response.interceptor.e2e-spec.ts # Response serialization tests
    │       └── response.interceptor.fixture.ts # Mock data/status routes for interceptor tests
    └── shared/                         # Shared E2E Test Infrastructure
        ├── interface/
        │   └── e2e-spec.interface.ts   # E2E options interface
        ├── auth-test-app.factory.ts    # Authenticated app generator
        ├── test-app.factory.ts         # Fastify app generator
        ├── user-admin-seeder.factory.ts # Database seeder helper
        ├── database.cleaner.ts         # Database cleaner helper
        ├── cache.cleaner.ts            # Redis cache cleaner helper
        └── dto-assertion.util.ts       # expectDataDto, expectDataArrayDto, and expectErrorDto assertion wrappers
```

## 🛡️ Global Request Pipeline & Cross-Cutting Concerns

The application registers several global guards, interceptors, pipes, and filters inside `AppModule` to handle cross-cutting requests:

- **Rate Limiting (`FailSafeThrottlerGuard`)**:
    - Implements global throttling using the `ThrottlerModule` backed by the Redis State connection.
    - Designed as **fail-open**: if the Redis state server is unreachable, connection errors are logged and traffic is allowed through to prevent application outages.
    - Automatically bypassed in the `test` environment to avoid test suite interference.
- **Authentication & RBAC (`AuthGuard` & `AuthRolesGuard`)**:
    - **`AuthGuard`** checks for valid JWT access tokens globally, extracting the token payload and attaching it to the Fastify request context. It intercepts blocklisted sessions (`banned:${role}:${id}`) in Redis State. Bypassed via `@Public()`.
    - **`AuthRolesGuard`** enforces role-based access limits on endpoints decorated with `@Roles()`.
- **Response Formatting (`ResponseInterceptor`)**:
    - Automatically wraps all successful API responses in a standardized JSON envelope structure (`{ data: ... }`).
- **Validation & Payload Parsing (`NotEmptyBodyPipe` & `ValidationPipe`)**:
    - **`NotEmptyBodyPipe`** prevents mutation operations (POST/PATCH) with empty request bodies.
    - **`ValidationPipe`** enforces strict white-listing settings (strips unvalidated fields, forbids unknown values, and automatically maps request bodies to DTO classes).
- **Exception Filtering (`GlobalExceptionFilter`)**:
    - Intercepts all validation, client, and internal server errors, formatting them into standard error contracts (e.g. `ErrorDefaultDto`).

## 📌 Active Modules & Endpoints

### 1. Health Probe (`/api/health`)

- Health check endpoints that expose liveness/readiness indicators for orchestration platforms. Monitors heap memory, RSS memory, PostgreSQL database, and Redis connections.
- The `HealthService` is completely decoupled from direct Drizzle ORM/Postgres and Redis/ioredis dependencies using the `IDatabaseHealthIndicator` and `ICacheHealthIndicator` interfaces and token injection.

### 2. User Module (`/api/v1/user`)

- Public endpoint to register a new user account (`POST /api/v1/user`, `@Public()`).
- Standard CRUD actions, soft-deletion, and status updates of user accounts managed by `UserService`. Soft-deletion and deactivation trigger instant session eviction via `AuthService`.
- Search endpoint (`GET /api/v1/user/search`) enabling both users and admins to search user records by name or email with pagination support.
- Uses Argon2 for secure password handling.

### 3. Authentication & Authorization (`/api/v1/auth`)

- **Secure-by-Default**: JWT-based authentication enabled globally (`JwtAuthGuard` and `RolesGuard`). Bypassed using the `@Public()` decorator.
- **Login Routes**: Separate credential validation portals:
    - User Login: `POST /api/v1/auth/user/login` (queries `users` table)
    - Admin Login: `POST /api/v1/auth/admin/login` (queries `admins` table)
- **Unified Refresh Route**: A single endpoint `POST /api/v1/auth/refresh` that verifies and rotates both user and admin sessions.
- **Refresh Token Rotation (RTR)**: Implements single-session rotation with replay attack detection. If a used token is replayed, all active sessions for the user are immediately revoked.
- **Instant Session Eviction**: Integrates Redis blocklist keys (`banned:${role}:${id}`) check inside `JwtAuthGuard` to block banned or deleted principals instantly.
- **Role-Based Access Control (RBAC)**: Supports roles `'user'`, `'admin'`, and `'super_admin'` via separate `users` and `admins` database tables.
- **Explicit Ownership Separation**: Removed custom ownership guards in favor of direct token-payload-based `/user/me` routes for mutating self operations, restricting parameterized `/user/:id` read operations to Admin/SuperAdmin roles.

### 4. Admin Module (`/api/v1/admin`)

- Administrative actions restricted to authorized roles.
- The `AdminService` manages registration/creation of new admins (restricted to `'super_admin'`), status updates of admin accounts, and soft-deleting admin accounts (restricted to `'super_admin'`). Deactivation or deletion triggers session invalidation.
- Admin creation automatically generates a strong temporary password, hashes it to store in database, and schedules a welcome email to the admin. If scheduling the email fails, the transaction is manually rolled back (admin record is hard deleted).

### 5. Email Module

- Asynchronously sends emails using BullMQ background worker queues backed by Redis to prevent blocking request cycles.
- Sends emails via Google Gmail API OAuth2 using OAuth Client ID, Secret, and Refresh Token configurations.

### 6. Cache & Session State Module (Split Client Architecture)

- **Split Connection Design**: The application maintains two separate Redis client instances and connection ports:
    - **Cache Client (`RedisService`)**: Responsible for transient application data caching (like caching user details or user lists). Implements automatic JSON serialization, recursive sanitization to strip sensitive fields (such as passwords), and fail-open resilience (reverts to db queries on connection failure).
    - **State Client (`RedisStateService`)**: Responsible for critical session state and authentication tokens (refresh tokens, replay attack tracking, and session blocklisting).
- **Observability & Management**:
    - **`RedisHealthIndicator`**: Pings both the Cache and State clients to provide complete readiness information.
    - **`RedisCleanerService`**: Performs flush operations across both Cache and State databases synchronously during testing teardowns.

## 💾 Database Schema Layout

The database uses **Drizzle ORM** with **PostgreSQL**.

### 1. `users` Table

- `id`: uuid (primary key)
- `email`: text (unique, not null)
- `name`: text (not null)
- `password`: text (not null, hashed)
- `isActive`: boolean (default true)
- `deletedAt`: timestamp (soft delete)
- `createdAt` / `updatedAt`: timestamp (managed base fields)

### 2. `admins` Table

- `id`: uuid (primary key)
- `email`: text (unique, not null)
- `name`: text (not null)
- `password`: text (not null, hashed)
- `role`: admin_role enum (`admin`, `super_admin`, default `admin`)
- `isActive`: boolean (default true)
- `deletedAt`: timestamp (soft delete)
- `createdAt` / `updatedAt`: timestamp (managed base fields)

---

## 🧪 Testing Infrastructure

The E2E test suite handles lifecycle synchronization and database/cache purging:

- **Vitest**: Configured as the test runner. The global config in `vitest.config.mts` defines `restoreMocks: true` by default, so there is no need to manually call clear/reset/restore mock functions in test suites.
- **Utility Helpers** (in `test/shared/`): Decoupled helpers automatically compile modules (`test-app.factory.ts`), purge DB/Cache states (`database.cleaner.ts`, `cache.cleaner.ts`), and validate schema/DTO shapes (`dto-assertion.util.ts`).
- **Auto-purging**: Every E2E test uses `cleanupDatabase` and `cleanupCache` during hooks to guarantee test isolation.
- **Strict DTO Validations**: E2E test responses are fully validated against standard schemas utilizing `expectDataDto`, `expectDataArrayDto`, and `expectErrorDto` assertion wrappers.
- **Controller-Bound Test Scope**: E2E test suites must only target the HTTP endpoints of their respective controller (e.g., `auth.e2e-spec.ts` only invokes `/auth` endpoints). Any setup or verification of side-effects must be performed directly using repositories or injected services (e.g., `authService.ban(...)` or `usersRepository.update(...)`) instead of sending requests to external controllers.
- **Standardized Describe Headers**: Describe block headers in all E2E spec files must exclude version prefixes (e.g., `POST /auth/user/login` instead of `POST /api/v1/auth/user/login`).
