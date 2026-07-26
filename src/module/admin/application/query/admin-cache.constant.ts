/**
 * @file admin-cache.constant.ts
 * @description Query layer constants for Admin module caching.
 */

/**
 * TTL for the cached admin auth-state (ban status + session version). Deliberately short: this read
 * gates every authenticated admin request, so the TTL is the security backstop bounding how long a
 * missed eviction could serve a stale ban/version — invalidation (pipeline + events) is the primary
 * path.
 */
export const ADMIN_AUTH_STATE_CACHE_TTL_SECONDS = 60;
