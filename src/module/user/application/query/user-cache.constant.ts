/**
 * @file user-constant.ts
 * @description Query layer constants for User module caching.
 */

export const USER_CACHE_TTL_SECONDS = 300;

/**
 * TTL for the cached user auth-state (ban status + session version). Deliberately short: this read
 * gates every authenticated request, so the TTL is the security backstop bounding how long a missed
 * eviction could serve a stale ban/version — invalidation (pipeline + events) is the primary path.
 */
export const USER_AUTH_STATE_CACHE_TTL_SECONDS = 60;
