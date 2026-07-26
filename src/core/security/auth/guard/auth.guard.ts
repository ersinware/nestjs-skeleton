/**
 * @file auth.guard.ts
 * @description Authentication guard using JWT access tokens. Checks the cached session version for instant session eviction.
 */

import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { auditContextStorage } from 'src/core/observability/audit';
import type { AuthenticatedRequest } from 'src/core/security/auth/authenticated-request.interface';
import { KEY_DECORATOR_PUBLIC } from 'src/core/security/auth/decorator/public.decorator';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { AuthTokenType, TOKEN_TOKEN_PORT, type AccessTokenPayload, type ITokenPort } from 'src/core/security/token';
import {
    DependencyUnavailableException,
    DependencyUnavailableMessage,
    UnauthenticatedException,
    UnauthenticatedMessage,
} from 'src/shared/exception';

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
     * @throws {DependencyUnavailableException} if the cache is unreachable — the guard fails closed rather than skipping the session-version check.
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
            // dependency outage the client may retry; the global filter keeps 503s out of the logs and
            // Sentry — detection is the health-endpoint alarm's job.
            throw new DependencyUnavailableException(DependencyUnavailableMessage.DEFAULT, { cause: error });
        }

        if (payload.version < currentVersion) {
            throw new UnauthenticatedException();
        }

        request.accessTokenPayload = payload;
        this.publishActor(payload);

        return true;
    }

    /**
     * Publishes the verified principal into the ambient audit context.
     *
     * This guard is where the fact "this identity is established" comes into existence, so by the
     * project's audit rule it is also where that fact is published — not somewhere downstream that
     * merely observes the result. The distinction is load-bearing rather than stylistic: an
     * interceptor doing this would run AFTER every guard, so a `403` raised by the roles guard — a
     * refusal that is entirely ABOUT this identity's role — would be recorded with no actor at all.
     *
     * Only a VERIFIED payload is published. A decoded-but-unverified token would let a caller name
     * itself in the audit trail, which does not produce an unattributed record but a forged one.
     *
     * The store is absent only outside an HTTP request, where no actor exists to attribute either.
     *
     * @param payload The access-token payload this guard has just verified.
     */
    private publishActor(payload: AccessTokenPayload) {
        const auditContext = auditContextStorage.getStore();

        if (auditContext) {
            auditContext.actorId = payload.sub;
            auditContext.actorRole = payload.role;
        }
    }
}
