/**
 * @file auth.guard.ts
 * @description Authentication guard using JWT access tokens. Checks the cached session version for instant session eviction.
 */

import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
    ServiceUnavailableException,
    ServiceUnavailableType,
    UnauthenticatedException,
    UnauthenticatedType,
} from 'src/core/exception';
import { KEY_DECORATOR_PUBLIC } from 'src/core/security/auth/decorator/public.decorator';
import { AuthTokenType } from 'src/core/security/auth/enum/auth-token-type.enum';
import type { AuthenticatedRequest } from 'src/core/security/auth/interface/authenticated-request.interface';
import type { AccessTokenPayload } from 'src/core/security/auth/type/access-token-payload.type';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session/port';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';

/**
 * Authentication guard enforcing global JWT check with automatic instant eviction via the cached session version.
 */
@Injectable()
export class AuthGuard implements CanActivate {
    /**
     * Creates an instance of AuthGuard.
     *
     * @param tokenPort Access and Refresh Token security operations helper service.
     * @param sessionPort Session operations helper service.
     * @param reflector NestJS metadata utility helper class.
     */
    constructor(
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        private readonly reflector: Reflector,
    ) {}

    /**
     * Determines whether the current request is authorized to proceed.
     * Checks for `@Public()` routes, verifies token signature/expiration, and enforces the session version.
     *
     * @param context Execution context of the request.
     * @returns A promise resolving to true if authorized.
     * @throws {UnauthenticatedException} if token validation or the session-version check fails.
     * @throws {ServiceUnavailableException} if the cache is unreachable — the guard fails closed rather than skipping the session-version check.
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
            throw new UnauthenticatedException(UnauthenticatedType.MISSING_CREDENTIALS);
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

        // Separate secrets already prevent verifying a refresh token here, but assert the claimed type
        // explicitly so a token minted for any other purpose can never satisfy the access-token check.
        if (payload.type !== AuthTokenType.ACCESS) {
            throw new UnauthenticatedException();
        }

        let currentVersion: number;
        try {
            currentVersion = await this.sessionPort.getVersion(payload.sub);
        } catch (error) {
            // Fail closed: without the cached version we cannot honour instant session eviction, so we
            // reject rather than admit a possibly-revoked token. 503 (not 500) marks this as a transient
            // dependency outage the client may retry; the global filter also reports it to Sentry.
            throw new ServiceUnavailableException(ServiceUnavailableType.DEFAULT, { cause: error });
        }

        if (payload.version < currentVersion) {
            throw new UnauthenticatedException();
        }

        request.accessTokenPayload = payload;

        return true;
    }
}
