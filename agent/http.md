# HTTP

### Health Probes

Paths are version-neutral and relative to the global prefix.

- `/health/live`: public, bodyless 204; no checks or dispatch.
- `/health/ready`: public, bodyless 204 when readiness indicators pass, 503 on their failure; never disclose topology.
- `/health/status`: requires `Permission.HEALTH_DETAIL_READ`; returns indicator details with 200/503.
- Checks are uncached. Readiness includes fail-closed session/rate-limit stores; cache failure must not remove an otherwise ready instance. Dependency checks must not consume rate-limit budgets. Replica probe reuse: [Dependency Outages](observability.md#dependency-outages).
- Use readiness for traffic eligibility and liveness for restart/replacement decisions. Verify platform health-check consequences, including load-balancer checks; dependency outages must not restart healthy processes.
- Preserve Terminus `ServiceUnavailableException`: the filter makes readiness 503 bodyless and preserves detailed indicator reports under `error`. Other failures follow [Exceptions](exceptions.md#exceptions); required session or rate-limit checks can produce a standard guard 503 before detailed checks run.
- Bound check execution within deployment probe timeouts. DB probes use the application's pool acquisition, server statement, and client query timeouts; allow response margin beyond the statement limit and deployment margin beyond acquisition + query waits. HTTP cache policy: [HTTP Caching](http.md#http-caching).

### Client Access

- Support web access through a BFF and direct mobile access through the API ingress. Both paths require trusted IP forwarding: ingress sanitizes client-supplied forwarded headers, the BFF propagates the trusted browser IP, and `TRUST_PROXY` identifies actual proxy IPs/CIDRs. Verify both paths after deployment; limiters use Fastify's resolved `request.ip`.

### HTTP Caching

- GET/HEAD handlers require method-level `@HttpCache(HttpCachePolicy.X)`; forbid it on classes/other methods. Missing GET/HEAD or misplaced non-GET/HEAD policies throw `SystemException`; other methods use `no-store`.
- Use `NO_STORE` for probes, tokens, and non-storable data; prefer `PRIVATE_REVALIDATE` for identity-scoped reads. Reserve `PUBLIC_REVALIDATE` for identity-free, shareable data.
- Require revalidation before reuse, preserving guards/audit; allow freshness only by explicit design for identity-free, non-audited public data.
- `core/http/caching`: `HttpCacheInterceptor` sets policy; `httpCacheHook` (Fastify `onSend`) forces errors/missing policy headers to `no-store` and gives storable GET/HEAD 200 string/Buffer bodies weak ETags; matching `If-None-Match` returns bodyless 304.
- ETags save response transfer, not handler execution ([CQRS](architecture.md#cqrs)).
- Disable BFF fetch caching; forward the browser's `If-None-Match` upstream and `ETag`/`Cache-Control`/304 downstream. Preserve the representation when forwarding its ETag; the browser owns the validator.

### DTOs & Responses

- Body DTOs use HTTP-method prefixes (`post-user-registration.dto.ts` / `PostUserRegistrationDto`); path/query/output/error DTOs use `param-`/`query-`/`response-`/`error-`.
- Every DTO declares `@ApiSchema({ name, description })`: name = class minus `Dto`; description = purpose. Response DTOs use `@Exclude()` and field-level `@Expose()`. Input DTOs use neither `@Exclude()` nor `@Expose()`; preserve unknown fields for global whitelist rejection and never enable `excludeExtraneousValues`. Mapped DTOs redeclare applicable class decorators and inherit unchanged field metadata. Property JSDoc explains meaning ([JSDoc](coding-conventions.md#jsdoc)).
- Every DTO field requires a schema-valid `example`, declared directly or inherited through mapped DTOs/composed decorators.
- Reuse matching decorators from `src/core/http/validation/decorator/`; override labels only when needed. `isUUID` defaults to UUID v7; use `{ version: 'all' }` for pg-boss IDs, with `nullable` distinct from `optional`. One-off fields use raw validators + `@ApiProperty`; compose on the second use of the same field contract and migrate both uses.
- Keep OpenAPI constraints aligned with field contracts. HTTP validation errors need field-label-based custom messages, supplied by decorators or constraints.
- Opt into `Trim()` for text fields; name/email decorators include it, names also use NFC. Preserve credentials, machine identifiers, and interior whitespace; never turn blank strings into missing values. Response name/email decorators require `{ normalize: false }`: `toClassOnly` includes response `plainToInstance` calls.
- Publish regex `.source` as OpenAPI `pattern`; `script/spectral-unicode.mjs` preserves built-in Spectral example checks while adapting Unicode patterns. Other regex flags need separate handling.
- Treat omission and null independently: `@IsOptional()` skips both; when only omission is allowed, use `PartialType(..., { skipNullProperties: false })` or `@ValidateIf` checking only undefined. Composed validators and OpenAPI must preserve that distinction. Responses add no raw validators; document constraints through `@ApiProperty` or existing composed field decorators.
- Properties are `readonly`; use `?` for optional fields and `!` for required fields without initialization. Preserve applicable exposure, documentation, and input validation.
- Convert read-models to response DTOs at HTTP edges with `plainToInstance` or explicit DTO construction; return annotations alone do not filter fields ([CQRS](architecture.md#cqrs)).
- `ResponseInterceptor` alone adds the success `{ data }` envelope; keep 204/304 bodyless. Errors: [Exceptions](exceptions.md#exceptions). Pagination uses `QueryPaginationDto` and `ResponsePaginationDto`.

### API Documentation

- Document endpoint tags, operations, authentication, and success/applicable error responses. Order response decorators by ascending HTTP status within each class or method. Reuse `src/core/doc/decorator/` when status/body contracts match; otherwise use raw Swagger decorators.
- Standard error decorators accept `message: string`, defaulting to the corresponding shared `DEFAULT`, never module-specific enum types.
- Error descriptions cover all causes: masked errors use public defaults ([Exceptions](exceptions.md#exceptions)); otherwise one cause uses its client-safe message, several use a generic description. Validation-only 400s use `RequestValidationMessage.PAYLOAD`/`PARAM`. No endpoint cause-enumeration enums; clients branch on status, not message text.
- Declare payload schemas without outer envelopes; `swagger-document.factory.ts` adds `data`/`error`. Document bodyless responses without body schemas. DTO metadata: [DTOs & Responses](http.md#dtos--responses); 304 metadata: `@HttpCache` ([HTTP Caching](http.md#http-caching)).
- Document response alternatives with `oneOf`; register referenced DTOs with `@ApiExtraModels`. Object unions declare `type: 'object'`; tagged unions require a discriminator mapping and a required, distinct literal field in each DTO. Derived envelope examples use the first alternative, never merge branches.
- Keep controller tags aligned with `APITag` in `src/core/doc/doc.config.ts`; add `VERSION_CONFIG` descriptions for every new tag/version.
