# HTTP

## Mutation Retry Safety

- Design mutation endpoints to be retry-safe: either naturally idempotent or protected by request idempotency. A timeout, connection loss, or lost response does not prove failure; treat the outcome as unknown and, when retrying a protected request, reuse the same idempotency key for the same logical request.
- Require a UUID v4 `Idempotency-Key` when repeating the same logical request could apply another mutation or create another durable effect. Reuse the same key for the same logical request and use a new key for new work; reusing a key for a different semantic request must fail with a conflict.
- Build idempotency fingerprints from the canonical endpoint identity and validated semantic input, including verified actor identity when it changes the meaning of the request. Do not fingerprint raw URLs or incidental transport representation.
- Keep natural idempotency, HTTP request retry-safety, and downstream job/external-effect safety distinct. Request idempotency does not provide exactly-once downstream delivery. Keep the [idempotency and retry-safety inventory](../docs/idempotency-retry-inventory.md) current when mutation semantics change.

## Health Probes

- `/health/live` is a public, bodyless liveness signal and checks no dependency. Dependency outages must not make liveness request process replacement.
- `/health/ready` is a public, bodyless traffic-eligibility signal. Dependencies required for correct request handling must gate readiness; degradable cache failure does not. Readiness is neither cached nor rate-limited.
- `/health/status` is the authorized detailed diagnostic view. It may expose dependency-level health that public probes must not disclose.
- Keep liveness, readiness, and detailed diagnostics semantically separate. Health failure transport behavior follows [Exceptions](exceptions.md#exceptions), while dependency outage reporting follows [Observability](observability.md#dependency-outages).

## Client Address

- Security, rate limiting, and audit decisions that depend on client IP must use the server's trusted, proxy-resolved address. Ingress must sanitize client-supplied forwarding headers, and proxy trust must be limited to actual trusted proxies.

## HTTP Caching

- Every GET/HEAD handler declares its cache policy at method level. Do not place cache-policy metadata on controller classes or non-GET/HEAD methods. Other methods and error responses are `no-store`.
- Identity-scoped or audited responses must revalidate before reuse. Shared caching is only for identity-free, shareable data; freshness that can bypass the server requires an explicit decision and must not be used where guards or audit must run on every access.
- ETags validate the serialized representation and may save response transfer, but they do not skip handler execution, authorization, audit, or application reads. Do not treat HTTP validation as application caching.
- `204` and `304` responses remain bodyless.

## Request & Response Contracts

- Name body DTOs with the HTTP-method prefix (`post-`, `put-`, `patch-`, etc.); use `param-`, `query-`, `response-`, and `error-` for the corresponding transport roles. Class names mirror the file role in PascalCase.
- HTTP DTOs are transport contracts. Keep presentation types at the HTTP edge; application and domain layers must not depend on them.
- Every DTO declares `@ApiSchema({ name, description })`: the schema name is the class name without `Dto`, and the description states its purpose. Response DTOs use `@Exclude()` with field-level `@Expose()`; input DTOs use neither so unknown fields remain visible to global whitelist rejection. Do not enable `excludeExtraneousValues`. Mapped DTOs redeclare applicable class-level metadata and inherit unchanged field metadata.
- Treat omission and `null` independently. `@IsOptional()` skips both; when only omission is allowed, use `PartialType(..., { skipNullProperties: false })` or `@ValidateIf` that checks only `undefined`. OpenAPI metadata and composed validators must preserve the same distinction.
- Validate external input at the boundary and reject unknown fields rather than silently accepting client mistakes. Normalize text only when normalization is part of the field contract; preserve credentials, tokens, machine identifiers, and other values whose exact representation is meaningful.
- Response DTOs expose only intended client-safe fields. Map read models/results to response DTOs explicitly at the HTTP edge; TypeScript return annotations alone do not filter runtime data.
- Keep OpenAPI schemas aligned with runtime contracts, including required/optional/null semantics, bounds, formats, patterns, and response alternatives.
- Publish validation regex `.source` as the OpenAPI `pattern`. `script/spectral-unicode.mjs` preserves built-in Spectral example validation while adapting Unicode patterns; other regex flags require separate handling.
- Successful response bodies use the shared `{ data }` envelope; document payload schemas without manually adding that envelope. Error transport contracts are owned by [Exceptions](exceptions.md#exceptions).

## API Documentation

- Swagger text limits apply after interpolation: `@ApiOperation.summary` ≤ 80 characters and has no final period; `@ApiOperation.description` ≤ 200; all other descriptions, including DTO/schema, property, parameter, response, header, and tag descriptions, are ≤ 150. End every description except summaries with a period.
- Order response decorators by ascending HTTP status within each class or method.
- Document the API for client decisions: required input, authentication/permissions, outcomes, retry or asynchronous behavior, and required next steps. Do not expose persistence, audit, queue, or other internal implementation mechanics.
- Keep documented success and error contracts consistent with runtime behavior. Clients should branch on status and schema, not message wording.
- Document response alternatives with `oneOf` and register referenced DTOs with `@ApiExtraModels`. Object unions declare `type: 'object'`; tagged unions require a discriminator mapping and a required, distinct literal field in each DTO. Derived envelope examples use the first alternative and never merge branches.
- Represent alternative response shapes accurately and document bodyless responses as bodyless.
