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
import { TOKEN_CACHE_SERVICE } from 'src/cache/constant/cache.constant';
import type { ICacheService } from 'src/cache/interface/cache-service.interface';
import { KEY_DECORATOR_PUBLIC } from '../decorator/auth/public.decorator';
import type { AccessTokenPayload, AuthenticatedRequest } from './interface/auth.interface';
import { UnauthorizedType } from 'src/common/enum/error/unauthorized-type.enum';
import { InternalServerErrorType } from 'src/common/enum/error/internal-server-error-type.enum';
import { TokenService } from 'src/v1/auth/token.service';

/**
 * Global or route-level guard verifying JWT access tokens.
 * Fails fast if the user or admin is blocklisted in cache.
 */
@Injectable()
export class AuthGuard implements CanActivate {
    /**
     * Creates an instance of AuthGuard.
     *
     * @param reflector NestJS Reflector to read route metadata.
     * @param tokenService JWT token management service.
     * @param cacheService Generic cache service contract.
     */
    constructor(
        private readonly reflector: Reflector,
        private readonly tokenService: TokenService,
        @Inject(TOKEN_CACHE_SERVICE) private readonly cacheService: ICacheService,
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
            throw new UnauthorizedException(UnauthorizedType.TOKEN);
        }

        let payload: AccessTokenPayload;
        try {
            payload = await this.tokenService.verifyAccessToken(token);
        } catch {
            throw new UnauthorizedException(UnauthorizedType.TOKEN);
        }

        try {
            if (await this.cacheService.exists(`banned:${payload.role}:${payload.sub}`)) {
                throw new UnauthorizedException(UnauthorizedType.TOKEN);
            }
        } catch (error) {
            if (error instanceof UnauthorizedException) {
                throw error;
            }

            throw new InternalServerErrorException(InternalServerErrorType.DEFAULT);
        }

        request.accessTokenPayload = payload;

        return true;
    }
}
