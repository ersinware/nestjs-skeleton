/**
 * @file authenticated-request.type.ts
 * @description Fastify request extended with the verified access-token payload.
 */

import type { FastifyRequest } from 'fastify';
import type { AccessTokenPayload } from 'src/core/security/token';

/**
 * Request shape after `AuthenticationGuard` ran: carries the verified access-token payload.
 */
export type AuthenticatedRequest = FastifyRequest<{ readonly Params: Readonly<Record<string, string>> }> & {
    /**
     * Verified JWT payload; absent on `@Public()` routes.
     */
    accessTokenPayload?: AccessTokenPayload;
};
