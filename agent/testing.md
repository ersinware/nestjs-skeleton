# Testing Rules

## What to Test

- Test observable behavior and contract-relevant effects. Assert internal calls, argument details, counts, or ordering only when correctness depends on them.
- On failure paths, assert the important effects that must not occur, especially persistence, audit, delivery, external effects, and downstream command execution.
- Validation tests must verify which inputs are accepted or rejected, the returned HTTP status, and the error response shape. Assert exact error messages only when message generation itself is the behavior under test.
- Do not verify DTO validation by unit-testing DTO classes directly. Exercise validation through the real Nest HTTP pipeline so decorators, transformation, whitelist behavior, and relevant pipe configuration are tested together.
- Unit and E2E Vitest configs enable `restoreMocks` and `clearMocks`; do not duplicate automatic cleanup. Use targeted reset/restoration only when a scenario requires it.
- Test each behavior at the layer that actually guarantees it. Use unit tests for domain/application decisions, real PostgreSQL/Redis/queue/storage dependencies for infrastructure, concurrency, and atomicity guarantees, and the real Nest request pipeline for HTTP behavior.
- When correctness depends on distributed coordination, transactions, retries, idempotency, locking, or provider semantics, do not replace the mechanism with a mock that removes the property being tested.

## Production Fidelity

- Higher-level tests must use the production modules, guards, pipes, interceptors, filters, and request-path wiring that affect the behavior under test. Test-only overrides may isolate external dependencies or inject faults, but must not bypass the behavior being verified.
- E2E test applications must behave like production on the request path. Do not omit or change bootstrap behavior such as global routing, versioning, hooks, or middleware when it can change the request outcome.
- Exercise infrastructure through production ports/adapters. Direct database, Redis, SDK, or provider-client access is acceptable only when the test intentionally targets that adapter or needs independent observation, fault injection, setup, or cleanup.
- Do not weaken production security rules, limits, or invariants to make tests easier to pass. Resolve test collisions with test-owned data, identities, and isolated namespaces instead.
- Any bypass needed for contract/fuzz testing must exist only in test bootstrap code and must not enter the production code path. Bypass only the targeted constraint; keep unrelated guards, policy validation, and health/readiness behavior intact.

## Isolation & Determinism

- Tests must be order-independent and must not rely on runner serialization. Isolate external state per test/run and clean up owned resources even when assertions fail.
- Never depend on development data, shared non-test infrastructure, or another test's leftovers. Tests that verify shared state across multiple application instances must intentionally use the same isolated test namespace; unrelated tests must use separate namespaces.
- For rate-limit tests, isolate counter state per application/test unless shared quota is the behavior under test. Build tracker identities the same way production does, and when testing shared or cross-instance limits, use the real distributed counter implementation and Redis rather than mocks.
- For storage tests, exercise the production storage contract. Local S3-compatible infrastructure validates application behavior, not AWS parity; real AWS acceptance requires an explicit isolated opt-in target.

## Placement

- `test/` architectural boundaries remain TODO; direct writer imports remain allowed. Until boundaries are defined, follow the existing source import restrictions where applicable and do not infer stricter `test/` isolation than the repository currently enforces.
- Keep unit and configuration `*.spec.ts` files next to the source or configuration they test. Reserve `test/` for E2E, contract, and shared test-support code.
- Reserve `test/` for E2E/contract tests and shared test support.
- Test code may reach concrete implementations when the test intentionally targets them or needs setup/observation/fault injection/cleanup; do not bypass an architectural boundary when claiming to verify the higher-level contract.
