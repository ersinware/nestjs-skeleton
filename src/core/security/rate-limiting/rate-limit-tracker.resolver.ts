/**
 * @file rate-limit-tracker.resolver.ts
 * @description Source resolution contract independent of individual resolver implementations.
 */

import type { FastifyRequest } from 'fastify';

/**
 * Resolves a tracker from its configured request source.
 */
export interface IRateLimitTrackerResolver {
    /**
     * Produces a non-empty canonical tracker without querying counter storage.
     *
     * @param request Current HTTP request.
     * @returns Canonical counter tracker.
     * @throws {InvalidInputException} When a required client-supplied source is invalid.
     * @throws {SystemException} When a required server-established source is unavailable.
     */
    resolve(request: FastifyRequest): string;
}
