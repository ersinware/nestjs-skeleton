# Testing Rules

- Test observable outcomes and contract-relevant effects; assert arguments, counts, and order only where correctness depends on them. On failure, verify relevant forbidden effects do not occur.
- Validate fields/constraints and HTTP status/error shape; assert exact validation text only when testing message generation.
- Unit and E2E configs enable `restoreMocks` and `clearMocks`; do not duplicate automatic cleanup. Allow targeted resets/restoration where needed.
- Unit-test domain/application behavior through ports; verify DB/Redis guarantees with real dependencies in integration tests.
- Do not write unit tests for DTOs.
- Test apps must use the same bootstrap configuration and wiring as production apps, including hooks, guards, pipes, interceptors, and filters.
- Run E2E tests through the pipeline; use `act` locally. Local validation must not publish SDKs or documentation. Provision dependencies in the workflow, never reuse development containers.
- Storage integration tests use the production module/port; direct SDK access is limited to observation, fault injection, and cleanup.
- SeaweedFS tests validate application storage behavior, not AWS parity. Real S3 acceptance requires explicit opt-in and an isolated test target; default suites must not reach AWS.
- Keep tests order-independent; clean up resources and isolate external test state from non-test data.
- Isolate rate-limit budgets per application and test case, including reused apps; share namespaces explicitly when testing cross-instance budgets. Keep fixture endpoint declarations and production guards; never raise production limits to pass tests. Verify limiter guarantees through the real counter adapter/Redis.
- Schemathesis alone may bypass rate-limit counters through a test-only entry point excluded from production builds; retain guards, policy validation and readiness. `not_a_server_error` accepts 429s.
- `test/` architectural boundaries remain TODO; direct writer imports remain allowed. Remind the user during test structure/import work until boundaries are defined. Existing import restrictions: [Layer Isolation](architecture.md#layer-isolation), [Jobs & Messaging](jobs-and-messaging.md#jobs--messaging).
- Colocate `*.spec.ts` tests with their implementation or configuration, including dependency-free Nest module tests. Reserve `test/` for E2E tests and support.
