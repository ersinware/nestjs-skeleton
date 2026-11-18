# TEMP — Testing Relocation Notes

> Temporary holding file for testing details removed from the canonical agent guide. This content is not yet an approved standalone guide.

## Candidate for CI / Local Development Reference

- The E2E workflow provisions PostgreSQL, separate Redis services, and SeaweedFS explicitly. Exact service images, ports, health checks, caches, and setup commands belong in CI configuration rather than the agent testing guide.
- Local full-pipeline execution is available through the repository's `act`-based command. Exact local CI invocation and artifact behavior belong in developer/CI documentation.
- The E2E Vitest configuration currently disables file parallelism. Canonical tests must remain order-independent anyway; runner serialization is not a correctness guarantee.

## Candidate for Contract-Test Reference

- The Schemathesis bootstrap currently overrides only rate-limit counter admission so fuzzed requests can reach application logic while retaining production guards, auth-policy validation, request bootstrap, and readiness.
- The current Schemathesis command uses the `not_a_server_error` check; exact accepted status behavior and command-line flags belong with contract-test tooling.
- Contract-test bootstrap resolves the compiled application and uses the shared production application configuration. Exact startup command and build-artifact routing are tooling details.

## Intentionally Removed Rather Than Relocated

- Exact fixture class/function names and concrete helper wiring.
- Exact SeaweedFS/AWS SDK setup mechanics.
- Exact rate-limit fixture endpoint declarations, budget values, and test namespace key formats.
