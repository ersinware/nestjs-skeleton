# TEMP — HTTP Relocation Notes

> Temporary holding file for HTTP details removed from the canonical agent guide. This content is not yet an approved standalone guide.

## Candidate for Deployment / Client Integration Reference

- The previous guide described web access through a BFF and direct mobile access through API ingress, including trusted browser-IP propagation. No BFF implementation or tracked BFF issue is present in the repository; keep this out of canonical guidance unless it is reaffirmed as an active architecture decision.
- The previous guide required disabling BFF fetch caching and forwarding browser `If-None-Match` / upstream `ETag`, `Cache-Control`, and `304`. This is client-integration behavior, not an application HTTP invariant.
- Exact health-probe timeout budgeting against database acquisition/query/statement and platform probe limits belongs in deployment/runbook guidance if operational documentation needs it.

## Intentionally Removed Rather Than Relocated

The following are source-visible, mechanically enforced, or low-level implementation details and should remain in code/configuration unless they become an engineering invariant:

- exact idempotency decorator/helper names, fingerprint array ordering, and UUID casing mechanics;
- exact shared DTO/helper class names for pagination, IDs, permissions, uploads, and validation messages;
- property-level `readonly`/definite-assignment rules already owned by `coding-conventions.md`;
- exact Swagger helper decorator names;
- tag/version configuration wiring already checked by generated OpenAPI/Spectral configuration.
