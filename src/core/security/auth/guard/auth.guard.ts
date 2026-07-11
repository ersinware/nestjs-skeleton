/**
 * @file auth.guard.ts
 * @description Authentication guard using JWT access tokens. Integrates with the cache blocklist for instant session eviction.
 */

import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
    InternalServerErrorType,
    SystemException,
    UnauthenticatedException,
    UnauthenticatedType,
} from 'src/core/exception';
import { KEY_DECORATOR_PUBLIC } from 'src/core/security/auth/decorator/public.decorator';
import type { AuthenticatedRequest } from 'src/core/security/auth/interface/authenticated-request.interface';
import type { AccessTokenPayload } from 'src/core/security/auth/type/access-token-payload.type';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session/port';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';

/**
 * Authentication guard enforcing global JWT check with automatic instant eviction using cache lookup.
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
     * Checks for `@Public()` routes, verifies token signature/expiration, and verifies blocklist presence.
     *
     * @param context Execution context of the request.
     * @returns A promise resolving to true if authorized.
     * @throws {UnauthenticatedException} if token validation or blocklist check fails.
     * @throws {SystemException} if cache connection fails.
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

        let isBanned = false;
        try {
            isBanned = await this.sessionPort.isBanned(payload.role, payload.sub);
        } catch (error) {
            throw new SystemException(InternalServerErrorType.DEFAULT, { cause: error });
        }

        if (isBanned) {
            throw new UnauthenticatedException();
        }

        request.accessTokenPayload = payload;

        return true;
    }
}
