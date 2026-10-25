/**
 * @file rate-limit-tracker-resolver-registry.ts
 * @description Source-to-resolver registry contract and its injection token.
 */

import type { IRateLimitTrackerResolverPort } from 'src/core/security/rate-limiting/port/rate-limit-tracker-resolver.port';
import type { RateLimitTrackerSource } from 'src/core/security/rate-limiting/rate-limit-tracker-source';

/**
 * Injection token for the shared {@link RateLimitTrackerResolverRegistry} registry.
 */
export const TOKEN_RATE_LIMIT_TRACKER_RESOLVER_REGISTRY = Symbol();

/**
 * Complete source-to-instance registry composed by the rate-limit module.
 */
export type RateLimitTrackerResolverRegistry = Readonly<Record<RateLimitTrackerSource, IRateLimitTrackerResolverPort>>;
