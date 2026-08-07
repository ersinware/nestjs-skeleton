/**
 * @file auth.guard.ts
 * @description Global authentication guard verifying JWT access tokens and the cached session version.
 */

import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { publishAuditActor } from 'src/core/observability/audit';
import type { AuthenticatedRequest } from 'src/core/security/auth/authenticated-request.type';
import { KEY_DECORATOR_PUBLIC } from 'src/core/security/auth/decorator/public.decorator';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { AuthTokenType, TOKEN_TOKEN_PORT, type AccessTokenPayload, type ITokenPort } from 'src/core/security/token';
import { UnauthenticatedException, UnauthenticatedMessage } from 'src/shared/exception';

/**
 * Global authentication guard: verifies the JWT access token and enforces the cached session
 * version, so a session bump evicts already-issued tokens instantly.
 */
@Injectable()
export class AuthGuard implements CanActivate {
    /**
     * @param tokenPort Verifies access tokens.
     * @param sessionPort Reads the current session version.
     * @param reflector Reads the `@Public()` metadata.
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
     * @throws {DependencyUnavailableException} if the cache is unreachable — fails closed rather than skipping the session-version check.
     */
    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (
            this.reflector.getAllAndOverride<boolean>(KEY_DECORATOR_PUBLIC, [context.getHandler(), context.getClass()])
        ) {
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

        let payload: AccessTokenPayload;
        try {
            payload = await this.tokenPort.verifyAccessToken(token);
        } catch {
            throw new UnauthenticatedException();
        }

        // Separate secrets already reject refresh tokens; the explicit type assert ensures a token
        // minted for any other purpose can never pass as an access token.
        if (payload.type !== AuthTokenType.ACCESS) {
            throw new UnauthenticatedException();
        }

        // Deliberately unguarded — the port's DependencyUnavailableException propagates, so the guard
        // fails closed: without the cached version, instant session eviction cannot be honoured, and
        // rejecting with a retryable 503 beats admitting a possibly-revoked token.
        const currentVersion = await this.sessionPort.getVersion(payload.sub);

        if (payload.version < currentVersion) {
            throw new UnauthenticatedException();
        }

        request.accessTokenPayload = payload;
        publishAuditActor(payload.sub, payload.role);

        return true;
    }
}
