# Jobs & Messaging — Temporary Relocation Notes

This file is not canonical guidance. It preserves only details that may belong in another guide during the final cross-review.

## Candidate for Observability

- Queue tracing currently persists optional W3C `traceparent` metadata across retry, DLQ, and redrive. Attempt-span and propagation rules should be owned by `observability.md`, not `jobs-and-messaging.md`.

## Candidate for Deployment / Operations Documentation

- Exact migration commands and environment variable names (`deploy:migrate`, `DATABASE_URL`, `PGBOSS_DATABASE_URL`) are operational/configuration details rather than architecture rules.
- Exact queue-provisioning reconciliation behavior (`policy`, `partition`, mutable option reconciliation) is implementation detail unless a dedicated operations guide needs it.

## Intentionally Removed Rather Than Relocated

The following are source-visible or low-level implementation details and should not return to the canonical guide unless they become an architectural invariant:

- exact polling profile durations;
- LISTEN/NOTIFY reconnect/backoff mechanics;
- exact `workerOptions`, `batchSize`, and `localConcurrency` wiring;
- shutdown ordering between DLQ monitoring, workers, and pools;
- `job-queue-operations` authorization/request-idempotency wiring;
- exact DLQ/redrive listing SQL ordering;
- exact Resend error names and exception mappings;
- exact application directory placement already owned by `architecture.md`;
- cache-key utility filenames and cache-eviction implementation wiring;
- local `act` secret wiring and other CI/runbook details.
