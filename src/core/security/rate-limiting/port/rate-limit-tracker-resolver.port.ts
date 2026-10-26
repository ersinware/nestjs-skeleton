/**
 * @file rate-limit-tracker-resolver.port.ts
 * @description Source resolution contract independent of individual resolver implementations.
 */

import type { FastifyRequest } from 'fastify';
import type { RateLimitTrackerField } from 'src/core/security/rate-limiting/rate-limit-policy';

/**
 * Resolves a tracker from its configured request source.
 */
export interface IRateLimitTrackerResolverPort {
    /**
     * Produces a non-empty canonical tracker without querying counter storage.
     *
     * @param request Current HTTP request.
     * @param field Required email body or resource ID route selector for target-account sources.
     * @returns Canonical counter tracker.
     * @throws {InvalidInputException} When a required client-supplied source is invalid.
     * @throws {SystemException} When a required server-established source or source configuration is unavailable.
     */
    resolve(request: FastifyRequest, field?: RateLimitTrackerField): string;
}
