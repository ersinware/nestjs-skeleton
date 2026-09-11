# HTTP

### Health Probes

Paths are version-neutral and relative to the global prefix.

- `/health/live`: public, bodyless 204; no checks or dispatch.
- `/health/ready`: public, bodyless 204 when all indicators pass, 503 on indicator failure; never disclose topology.
- `/health`: requires `Permission.HEALTH_DETAIL_READ`; returns indicator details with 200/503.
- Readiness/detail run uncached checks for `HEALTH_INDICATOR_KEYS`: `memory_heap`, `memory_rss`, `database`, `database_replica`, `cache`, `session`. All affect readiness. Replica probe reuse: [Dependency Outages](observability.md#dependency-outages).
- Use readiness for traffic eligibility and liveness for restart/replacement decisions. Verify platform health-check consequences, including load-balancer checks; dependency outages must not restart healthy processes.
- Preserve Terminus `ServiceUnavailableException`: the filter makes readiness 503 bodyless and preserves detailed indicator reports under `error`. Other failures follow [Exceptions](exceptions.md#exceptions); session unavailability can produce a standard guard 503 before detailed checks run.
- Bound check execution within deployment probe timeouts. DB probes use the application's pool acquisition, server statement, and client query timeouts; allow response margin beyond the statement limit and deployment margin beyond acquisition + query waits. HTTP cache policy: [HTTP Caching](http.md#http-caching).

### HTTP Caching

- GET/HEAD handlers require method-level `@HttpCache(HttpCachePolicy.X)`; forbid it on classes/other methods. Missing GET/HEAD or misplaced non-GET/HEAD policies throw `SystemException`; other methods use `no-store`.
- Use `NO_STORE` for probes, tokens, and non-storable data; prefer `PRIVATE_REVALIDATE` for identity-scoped reads. Reserve `PUBLIC_REVALIDATE` for identity-free, shareable data.
- Require revalidation before reuse, preserving guards/audit; allow freshness only by explicit design for identity-free, non-audited public data.
- `core/http/caching`: `HttpCacheInterceptor` sets policy; `httpCacheHook` (`main.ts`, Fastify `onSend`) forces errors/missing policy headers to `no-store` and gives storable GET/HEAD 200 string/Buffer bodies weak ETags; matching `If-None-Match` returns bodyless 304.
- ETags save response transfer, not handler execution ([CQRS](architecture.md#cqrs)).
- The API is designed to run behind a BFF. Disable BFF fetch caching; forward the browser's `If-None-Match` upstream and `ETag`/`Cache-Control`/304 downstream. Preserve the representation when forwarding its ETag; the browser owns the validator.

### DTOs & Responses

- Body DTOs use HTTP-method prefixes (`post-user.dto.ts` / `PostUserDto`); path/query/output/error DTOs use `param-`/`query-`/`response-`/`error-`.
- Every DTO declares `@Exclude()` and `@ApiSchema({ name, description })`: name = class minus `Dto`; description = purpose. Expose each field with `@Expose()` and document it; property JSDoc explains meaning ([JSDoc](coding-conventions.md#jsdoc)). Mapped DTOs redeclare class decorators, inheriting unchanged field metadata.
- Reuse matching decorators from `src/core/http/validation/decorator/`; override labels only when needed. One-off fields use raw validators + `@ApiProperty`; compose on the second use of the same field contract and migrate both uses.
- Keep OpenAPI constraints aligned with field contracts. HTTP validation errors need field-label-based custom messages, supplied by decorators or constraints.
- Validate inputs; optional fields use direct/inherited/composed `@IsOptional()`. Responses add no raw validators; document constraints through `@ApiProperty` or existing composed field decorators.
- Properties are `readonly`; use `?` for optional fields and `!` for required fields without initialization. Preserve applicable exposure, documentation, and input validation.
- Convert read-models to response DTOs at HTTP edges with `plainToInstance` or explicit DTO construction; return annotations alone do not filter fields ([CQRS](architecture.md#cqrs)).
- `ResponseInterceptor` alone adds the success `{ data }` envelope; keep 204/304 bodyless. Errors: [Exceptions](exceptions.md#exceptions). Pagination uses `QueryPaginationDto` and `ResponsePaginationDto`.

### API Documentation

- Document endpoint tags, operations, authentication, and success/applicable error responses. Reuse `src/core/doc/decorator/` when status/body contracts match; otherwise use raw Swagger decorators.
- Standard error decorators accept `message: string`, defaulting to the corresponding shared `DEFAULT`, never module-specific enum types.
- Error descriptions cover all causes: masked errors use public defaults ([Exceptions](exceptions.md#exceptions)); otherwise one cause uses its client-safe message, several use a generic description. Validation-only 400s use `RequestValidationMessage.PAYLOAD`/`PARAM`. No endpoint cause-enumeration enums; clients branch on status, not message text.
- Declare payload schemas without outer envelopes; `swagger-document.factory.ts` adds `data`/`error`. Document bodyless responses without body schemas. DTO metadata: [DTOs & Responses](http.md#dtos--responses); 304 metadata: `@HttpCache` ([HTTP Caching](http.md#http-caching)).
- Keep controller tags aligned with `APITag` in `src/core/doc/doc.config.ts`; add `VERSION_CONFIG` descriptions for every new tag/version.
