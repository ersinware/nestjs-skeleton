/**
 * @file authentication.guard.ts
 * @description Global authentication guard verifying JWT access tokens, stable sessions, and account access floors.
 */

import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { publishAuditActor } from 'src/core/observability/audit';
import { isPublicAuthPolicy } from 'src/core/security/auth/auth-policy';
import type { AuthenticatedRequest } from 'src/core/security/auth/authenticated-request.type';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { UnauthenticatedException, UnauthenticatedMessage } from 'src/shared/exception';

/**
 * Global authentication guard: verifies the JWT access token and enforces the cached session
 * version together with the stable session; logout takes effect at the next admission check.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
    /**
     * Connects token verification, session admission, and route policy lookup.
     *
     * @param tokenPort Verifies access tokens.
     * @param sessionPort Reads the current session version.
     * @param reflector Reads and validates the endpoint access policy.
     */
    constructor(
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        private readonly reflector: Reflector,
    ) {}

    /**
     * Admits `@Public()` routes, otherwise verifies the Bearer token and the session version.
     *
     * @param context Execution context of the request.
     * @returns A promise resolving to true if authenticated.
     * @throws {UnauthenticatedException} if the token or the session-version check fails.
     * @throws {DependencyUnavailableException} if the session store is unavailable; admission fails closed.
     */
    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (isPublicAuthPolicy(this.reflector, context.getClass(), context.getHandler())) {
            return true;
        }

        const request = context.switchToHttp().getRequest<AuthenticatedRequest>(),
            authorization = request.headers['authorization'];

        if (!authorization) {
            throw new UnauthenticatedException(UnauthenticatedMessage.MISSING_CREDENTIALS);
        }

        const [type, token] = authorization.split(' ');

        if (type !== 'Bearer' || !token) {
            throw new UnauthenticatedException();
        }

        const payload = await this.tokenPort.verifyAccessToken(token);

        // One authoritative read checks both individual logout and account-wide access retirement.
        // Availability failures propagate as 503; missing or closed state denies with 401.
        if (
            !(await this.sessionPort.isSessionActive(
                payload.sub,
                payload.principalType,
                payload.sid,
                payload.sessionVersion,
            ))
        ) {
            throw new UnauthenticatedException();
        }

        request.accessTokenPayload = payload;
        publishAuditActor(payload.sub, payload.principalType);

        return true;
    }
}
