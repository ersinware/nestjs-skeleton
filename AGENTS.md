# NestJS Modular Monolith — Agent Guide

## Working Rules

- Explain guide conflicts and their impact; propose compliant alternatives. Explicit rule revisions are intentional changes.
- Limit work to the task and necessary related updates; exclude unrelated refactors, features, and tests.
- Verify current behavior/structure claims against code/configuration; distinguish implementation from plans.
- Write/update tests or run tests, type checks, builds, lint, or formatting only on explicit request; report verification and skipped checks.
- After each change, assess `AGENTS.md` and `agent/`; update only guidance needed for future work, within the same task. Do not record change history.
- Guide edits: use the fewest words that preserve clarity and meaning; state each rule once in its owning section. Cross-reference when useful; use examples/rationale only to resolve ambiguity. Keep ESLint implementation details in configuration comments.

## Purpose & Architecture

Production-ready NestJS reference skeleton: strict DDD, Hexagonal Architecture, horizontal scalability, Lift-and-Shift microservice readiness. Correctness, security, and standards outrank convenience. Keep cloning free of project identity/unfinished features and contexts extractable without rewrites.

## Reading the Guide

This file and the topic guides in `agent/` form one project guide. Topic rules retain their full scope wherever the relevant behavior is implemented, including core, modules, bootstrap, configuration, and tests. Repository paths in the guides remain relative to the repository root; Markdown links are relative to their containing file.

Before changing or reviewing a relevant area, read the guides selected below. For work spanning several areas, read each applicable guide. Follow cross-references for the rules and exceptions relevant to the task; expand the selection when the task reveals additional affected behavior. Read all topic guides for a repository-wide review or guide reorganization.

| Work area                                                                                                                                         | Required reading                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Source or test code: architecture, imports, placement, naming, barrels, module boundaries, DI, commands, queries, pipelines                       | [Architecture](agent/architecture.md)                                        |
| Writing or reviewing code, JSDoc, types, signatures, environment variables, configuration, or route constants                                     | [Coding Conventions](agent/coding-conventions.md)                            |
| Aggregates, mutations, persistence, schemas, migrations, readers/writers, database selection, concurrency, or caching                             | [Data & State](agent/data-and-state.md)                                      |
| Events, jobs, queues, publishers, consumers, cross-context mutations, reconciliation, or cache invalidation                                       | [Events & Messaging](agent/events-and-messaging.md)                          |
| Authentication, authorization, principals, permissions, administration, passwords, sessions, tokens, Redis recovery, rate limiting, or email HTML | [Security & Sessions](agent/security-and-sessions.md)                        |
| Validation or business refusals, exceptions, error propagation/translation, dependency failures, or HTTP error mapping                            | [Exceptions](agent/exceptions.md)                                            |
| Endpoints, controllers, DTOs, validation decorators, responses, Swagger, HTTP caching, BFF forwarding, or health probes                           | [HTTP](agent/http.md)                                                        |
| Logging, tracing, metrics, audit, telemetry/deployment configuration, dependency outages, or health checks                                        | [Observability](agent/observability.md)                                      |
| Test changes/reviews, test configuration, fixtures, support, or verification design, including both `src/**/*.spec.ts` and `test/**`              | [Testing Rules](agent/testing.md) and the guides for the behavior under test |

Mutation evidence and durable delivery require both [Events & Messaging](agent/events-and-messaging.md) and [Audit](agent/observability.md#audit). Health and dependency availability work requires [HTTP](agent/http.md#health-probes), [Dependency Outages](agent/observability.md#dependency-outages), and the applicable data/session failure rules.

## Reference Stack

NestJS / SWC; Fastify; PostgreSQL / Drizzle (`pg`); Redis (`ioredis`); Gmail (`googleapis`); Argon2; class-validator / class-transformer; Sentry / Pino / OTel Collector / Grafana Cloud; Vitest / Supertest / Spectral / Schemathesis.

Delivery migration: Admin and User use `core/job-queue`; Auth still uses the legacy pg-boss outbox and in-process event bus. Migrate Auth next, then remove `core/outbox` and the unused event-bus path ([Events & Messaging](agent/events-and-messaging.md#events--messaging)).
