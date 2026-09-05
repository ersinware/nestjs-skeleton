/**
 * @file http-cache-policy.enum.ts
 * @description The `Cache-Control` values a route may declare, and the header they are written to.
 */

/** Response header carrying the route's cache policy. */
export const HEADER_CACHE_CONTROL = 'cache-control';

/**
 * Closed set of `Cache-Control` values a route may declare via `@HttpCache`.
 *
 * No member grants freshness (`max-age`): a fresh copy is served without reaching the server, so
 * guards, the `@Audited` record and revocation are all skipped. HTTP caching here saves bytes,
 * never round-trips. A freshness-granting member is admissible only for identity-free public data,
 * never on an `@Audited` route.
 */
export enum HttpCachePolicy {
    /** Never stored. For probes, tokens, and anything a stale copy of would be wrong. */
    NO_STORE = 'no-store',
    /** Stored by the end client only, revalidated on every use. The default for identity-scoped reads. */
    PRIVATE_REVALIDATE = 'private, no-cache',
    /** Storable by shared caches, revalidated on every use. For identity-free data only. */
    PUBLIC_REVALIDATE = 'public, no-cache',
}
