/**
 * @file principal-tracker-resolver.adapter.ts
 * @description Resolves caller trackers from identity published after session admission.
 */

import { Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from 'src/core/security/auth';
import type { IRateLimitTrackerResolverPort } from 'src/core/security/rate-limiting/port/rate-limit-tracker-resolver.port';
import { SystemException } from 'src/shared/exception';

/**
 * Shares a caller's budget across sessions and IPs without performing credential verification.
 */
@Injectable()
export class PrincipalTrackerResolverAdapter implements IRateLimitTrackerResolverPort {
    /**
     * Reads the caller ID established by authentication after its session check.
     *
     * @param request Request carrying the verified access-token payload.
     * @returns Verified caller ID, independent of principal kind and session.
     */
    resolve(request: AuthenticatedRequest): string {
        const principalId = request.accessTokenPayload?.sub;
        if (!principalId) {
            throw new SystemException('Authentication did not publish a rate-limit principal.', {
                context: {
                    class: this.constructor.name,
                    method: this.resolve.name,
                },
            });
        }

        return principalId;
    }
}
