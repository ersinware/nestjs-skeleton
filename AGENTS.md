# NestJS Modular Monolith — Agent Guide

## Purpose

Production-ready NestJS reference skeleton: strict DDD, Hexagonal Architecture, horizontal scalability, and Lift-and-Shift microservice readiness. Prioritize correctness, security, and standards over convenience. Keep the skeleton free of project-specific identity and unfinished features; design contexts for extraction without rewrites.

## Working Rules

- Explain conflicts with this guide and their impact; propose compliant alternatives. Explicitly approved rule revisions are intentional exceptions.
- Stay within the requested scope and necessary related changes; avoid unrelated refactors, features, and tests.
- Verify claims about current behavior and structure against code/configuration; distinguish implemented behavior from plans.
- Write/update tests or run tests, type checks, builds, lint, or formatting only when explicitly requested. Report checks performed and skipped.
- After changes, consider whether `AGENTS.md` or `agent/` needs updating. Keep guidance as short as possible without losing meaning; retain only rules that prevent future decision errors. Omit code-obvious facts, progress notes, and history. Keep each rule once in its owning location, reference related guidance instead of repeating it, and use examples or rationale only when needed for clarity. Leave ESLint implementation details in configuration comments.

## Reading the Guide

`AGENTS.md` and `agent/` form one guide. Topic rules apply wherever relevant, including core, modules, bootstrap, configuration, and tests. Paths mentioned in the guides are repository-root-relative; Markdown links are relative to their file.

Before changing or reviewing an area, read every applicable topic guide below. Follow relevant cross-references and expand the selection as affected behavior becomes clear. For repository-wide reviews or guide reorganization, read all topic guides.

| Area | Required guide |
| --- | --- |
| Source/test architecture, boundaries, imports, placement, DI, CQRS | [Architecture](agent/architecture.md) |
| Code style, naming, JSDoc, types, environment/configuration, route constants | [Coding Conventions](agent/coding-conventions.md) |
| Aggregates, persistence, transactions, schemas, concurrency, caching | [Data & State](agent/data-and-state.md) |
| Jobs, queues, cross-context mutations, reconciliation, cache invalidation | [Jobs & Messaging](agent/jobs-and-messaging.md) |
| Authentication, authorization, administration, credentials, sessions, rate limiting, email HTML | [Security & Sessions](agent/security-and-sessions.md) |
| Refusals, exceptions, dependency failures, error mapping | [Exceptions](agent/exceptions.md) |
| Endpoints, controllers, DTOs, validation, responses, Swagger, HTTP caching, BFF, health | [HTTP](agent/http.md) |
| Logs, tracing, metrics, audit, telemetry, outages, health checks | [Observability](agent/observability.md) |
| Test code, fixtures, configuration, support, verification | [Testing](agent/testing.md) and guides for the behavior under test |

For mutation evidence and durable delivery, read both [Jobs & Messaging](agent/jobs-and-messaging.md) and [Audit](agent/observability.md#audit). For health or dependency availability, read [Health Probes](agent/http.md#health-probes), [Dependency Outages](agent/observability.md#dependency-outages), and relevant data/session failure rules.

## Commit Messages

Use Conventional Commits: `<type>(<scope>): <summary>`; add an optional body and an issue footer (`Refs #N`) when applicable. Never put issue numbers in the subject, including `(#N)`. Use `Fixes #N` or `Closes #N` only when the commit/merge actually closes the issue.

## Reference Stack

NestJS (SWC, Fastify); PostgreSQL (Drizzle, pg-boss); Redis; Vitest. Verify specific packages, tooling, and versions against `package.json` and configuration rather than treating this list as exhaustive.
