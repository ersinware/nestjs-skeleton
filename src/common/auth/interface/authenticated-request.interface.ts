/**
 * @file authenticated-request.interface.ts
 * @description Interface defining the extended HTTP Request context carrying parsed security attributes.
 */

import type { FastifyRequest } from 'fastify';
import type { AccessTokenPayload } from './access-token-payload.interface';

/**
 * Extended HTTP Request context carrying parsed security attributes.
 */
export interface AuthenticatedRequest extends FastifyRequest<{ Params: Record<string, string> }> {
    /** Authenticated user's JWT details. */
    accessTokenPayload?: AccessTokenPayload;
}
