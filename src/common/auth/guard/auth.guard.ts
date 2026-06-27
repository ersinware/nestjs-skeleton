/**
 * @file auth.guard.ts
 * @description Authentication guard using JWT access tokens. Integrates with the cache blocklist for instant session eviction.
 */

import {
    CanActivate,
    ExecutionContext,
    Inject,
    Injectable,
    UnauthorizedException,
    InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TOKEN_CACHE_STATE_SERVICE } from 'src/common/port/cache/cache.constant';
import type { ICacheStateService } from 'src/common/port/cache/cache-state-service.interface';
import { KEY_DECORATOR_PUBLIC } from 'src/common/auth/decorator/public.decorator';
import type { AccessTokenPayload } from '../interface/access-token-payload.interface';
import type { AuthenticatedRequest } from '../interface/authenticated-request.interface';
import { UnauthorizedType } from 'src/common/exception/enum/unauthorized-type.enum';
import { InternalServerErrorType } from 'src/common/exception/enum/internal-server-error-type.enum';
import { TOKEN_TOKEN_SERVICE } from 'src/common/port/security/token.constant';
import type { ITokenService } from 'src/common/port/security/token.service.interface';

/**
 * Authentication guard enforcing global JWT check with automatic instant eviction using cache lookup.
 */
@Injectable()
export class AuthGuard implements CanActivate {
    /**
     * Creates an instance of AuthGuard.
     *
     * @param tokenService Access and Refresh Token security operations helper service.
     * @param cacheStateService Session state operations helper service.
     * @param reflector NestJS metadata utility helper class.
     */
    constructor(
        @Inject(TOKEN_TOKEN_SERVICE) private readonly tokenService: ITokenService,
        @Inject(TOKEN_CACHE_STATE_SERVICE) private readonly cacheStateService: ICacheStateService,
        private readonly reflector: Reflector,
    ) {}

    /**
     * Determines whether the current request is authorized to proceed.
     * Checks for `@Public()` routes, verifies token signature/expiration, and verifies blocklist presence.
     *
     * @param context Execution context of the request.
     * @returns A promise resolving to true if authorized.
     * @throws {UnauthorizedException} if token validation or blocklist check fails.
     * @throws {InternalServerErrorException} if cache connection fails.
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
            throw new UnauthorizedException(UnauthorizedType.MISSING_CREDENTIALS);
        }

        const [type, token] = authorization.split(' ');

        if (type !== 'Bearer' || !token) {
            throw new UnauthorizedException(UnauthorizedType.DEFAULT);
        }

        let payload: AccessTokenPayload;
        try {
            payload = await this.tokenService.verifyAccessToken(token);
        } catch {
            throw new UnauthorizedException(UnauthorizedType.DEFAULT);
        }

        let isBanned = false;
        try {
            isBanned = await this.cacheStateService.isBanned(payload.role, payload.sub);
        } catch (error) {
            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT, { cause: error });
        }

        if (isBanned) {
            throw new UnauthorizedException(UnauthorizedType.DEFAULT);
        }

        request.accessTokenPayload = payload;

        return true;
    }
}
