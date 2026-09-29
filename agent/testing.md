# Testing Rules

- Test observable outcomes and contract-relevant effects; assert arguments, counts, and order only where correctness depends on them. On failure, verify relevant forbidden effects do not occur.
- Validate fields/constraints and HTTP status/error shape; assert exact validation text only when testing message generation.
- Unit and E2E configs enable `restoreMocks` and `clearMocks`; do not duplicate automatic cleanup. Allow targeted resets/restoration where needed.
- Unit-test domain/application behavior through ports; verify DB/Redis guarantees with real dependencies in integration tests.
- Test apps must use the same bootstrap configuration and wiring as production apps, including hooks, guards, pipes, interceptors, and filters.
- Run E2E tests through the pipeline; use `act` locally. Provision dependencies in the workflow, never reuse development containers.
- Keep tests order-independent; clean up resources and isolate external test state from non-test data.
- `test/` architectural boundaries remain TODO; direct writer imports remain allowed. Remind the user during test structure/import work until boundaries are defined. Existing import restrictions: [Layer Isolation](architecture.md#layer-isolation), [Jobs & Messaging](jobs-and-messaging.md#jobs--messaging).
- Colocate `*.spec.ts` tests with their implementation or configuration, including dependency-free Nest module tests. Reserve `test/` for E2E tests and support.
