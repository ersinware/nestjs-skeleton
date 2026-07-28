/**
 * @file authenticated-request.interface.ts
 * @description The extended HTTP Request context carrying parsed security attributes.
 */

import type { FastifyRequest } from 'fastify';
import type { AccessTokenPayload } from 'src/core/security/token';

/**
 * Extended HTTP Request context carrying parsed security attributes.
 */
export type AuthenticatedRequest = FastifyRequest<{ Params: Record<string, string> }> & {
    /** Authenticated user's JWT details. */
    accessTokenPayload?: AccessTokenPayload;
};
