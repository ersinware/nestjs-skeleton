/**
 * @file ip-tracker-resolver.adapter.ts
 * @description Resolves full canonical IP trackers exclusively from Fastify's trusted address.
 */

import { Injectable } from '@nestjs/common';
import { normalizeIp } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { isIP } from 'node:net';
import type { IRateLimitTrackerResolverPort } from 'src/core/security/rate-limiting/port/rate-limit-tracker-resolver.port';
import { SystemException } from 'src/shared/exception';

/**
 * Uses the adapter's validated proxy chain, never arbitrary forwarded headers.
 */
@Injectable()
export class IpTrackerResolverAdapter implements IRateLimitTrackerResolverPort {
    /**
     * Canonicalizes the trusted client IP without grouping distinct IPv6 addresses.
     *
     * @param request Request carrying the adapter-resolved IP.
     * @returns Full canonical IP, mapping IPv4-mapped IPv6 to IPv4.
     */
    resolve(request: FastifyRequest): string {
        if (!isIP(request.ip)) {
            throw new SystemException('The HTTP adapter did not resolve a valid rate-limit IP.', {
                context: {
                    class: IpTrackerResolverAdapter.name,
                    method: this.resolve.name,
                },
            });
        }

        // Explicit /128 disables the package's default /64 grouping; the suffix is not identity.
        return normalizeIp(request.ip, 128).replace(/\/128$/, '');
    }
}
