/**
 * @file auth.service.ts
 * @description Authentication service coordinating login, session refresh, logout, and session eviction using TokenService and SessionService.
 */

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { HashingService } from 'src/common/hashing/service/hashing.service';
import { UnauthorizedType } from 'src/common/enum/error/unauthorized-type.enum';
import { AuthTokenType } from 'src/common/enum/auth/auth-token-type.enum';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { RefreshTokenPayload } from 'src/common/guard/interface/auth.interface';
import { TOKEN_ADMINS_REPOSITORY } from 'src/v1/admin/constant/admin.constant';
import type { IAdminsRepository } from 'src/v1/admin/interface/admins.repository.interface';
import { TOKEN_USERS_REPOSITORY } from 'src/v1/user/constant/user.constant';
import type { IUsersRepository } from 'src/v1/user/interface/users.repository.interface';
import { PostAuthLoginDto } from './dto/post-auth-login.dto';
import { PostAuthRefreshDto } from './dto/post-auth-refresh.dto';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
    /**
     * Creates an instance of AuthService.
     *
     * @param usersRepository User persistence repository abstraction.
     * @param adminsRepository Admin persistence repository abstraction.
     * @param tokenService JWT token operations service.
     * @param sessionService Cache-based session operations service.
     * @param hashingService Hashing operations utility service.
     */
    constructor(
        @Inject(TOKEN_USERS_REPOSITORY) private readonly usersRepository: IUsersRepository,
        @Inject(TOKEN_ADMINS_REPOSITORY) private readonly adminsRepository: IAdminsRepository,
        private readonly tokenService: TokenService,
        private readonly sessionService: SessionService,
        private readonly hashingService: HashingService,
    ) {}

    /**
     * Authenticates user credentials, generates access and refresh tokens.
     *
     * @param dto User login credentials.
     * @returns Access and refresh token pair.
     * @throws {UnauthorizedException} if authentication fails.
     */
    async loginUser(dto: PostAuthLoginDto) {
        const user = await this.usersRepository.findByEmail(dto.email);

        if (!user) {
            throw new UnauthorizedException(UnauthorizedType.CREDENTIALS);
        }

        if (!user.isActive) {
            throw new UnauthorizedException(UnauthorizedType.CREDENTIALS);
        }

        if (!(await this.hashingService.verify(user.password, dto.password))) {
            throw new UnauthorizedException(UnauthorizedType.CREDENTIALS);
        }

        const id = user.id,
            tokens = await this.tokenService.generateTokens(AuthUserRole.USER, id);

        await this.sessionService.openSession(AuthUserRole.USER, id, tokens.jti);

        return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }

    /**
     * Authenticates administrative credentials, generates access and refresh tokens.
     *
     * @param dto Admin login credentials.
     * @returns Access and refresh token pair.
     * @throws {UnauthorizedException} if authentication fails.
     */
    async loginAdmin(dto: PostAuthLoginDto) {
        const admin = await this.adminsRepository.findByEmail(dto.email);

        if (!admin) {
            throw new UnauthorizedException(UnauthorizedType.CREDENTIALS);
        }

        if (!admin.isActive) {
            throw new UnauthorizedException(UnauthorizedType.CREDENTIALS);
        }

        if (!(await this.hashingService.verify(admin.password, dto.password))) {
            throw new UnauthorizedException(UnauthorizedType.CREDENTIALS);
        }

        const id = admin.id,
            role = admin.role,
            tokens = await this.tokenService.generateTokens(role, id);

        await this.sessionService.openSession(role, id, tokens.jti);

        return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }

    /**
     * Rotates refresh tokens and issues a new credentials pair.
     * Detects replay attacks, immediately invalidating all sessions for the user if detected.
     *
     * @param dto Token rotation refresh payload.
     * @returns New access and refresh token pair.
     * @throws {UnauthorizedException} if verification or rotation fails.
     */
    async refresh(dto: PostAuthRefreshDto) {
        let payload: RefreshTokenPayload;

        try {
            payload = await this.tokenService.verifyRefreshToken(dto.refreshToken);
        } catch {
            throw new UnauthorizedException(UnauthorizedType.TOKEN);
        }

        if (payload.type !== AuthTokenType.REFRESH) {
            throw new UnauthorizedException(UnauthorizedType.TOKEN);
        }

        const role = payload.role,
            sub = payload.sub;

        // Replay Attack detection (JTI is not active in the cache but token signature is valid)
        if (!(await this.sessionService.getSession(role, sub, payload.jti))) {
            await this.logoutAll(role, sub);
            await this.ban(role, sub);

            throw new UnauthorizedException(UnauthorizedType.TOKEN);
        }

        await this.sessionService.closeSession(role, sub, payload.jti);

        const user =
            role === AuthUserRole.USER
                ? await this.usersRepository.findById(sub)
                : await this.adminsRepository.findById(sub);

        if (!user || !user.isActive) {
            throw new UnauthorizedException(UnauthorizedType.TOKEN);
        }

        const tokens = await this.tokenService.generateTokens(role, sub);

        await this.sessionService.openSession(role, sub, tokens.jti);

        return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }

    /**
     * Invalidates a specific refresh session JTI.
     *
     * @param dto Logout session refresh payload.
     */
    async logout(dto: PostAuthRefreshDto) {
        let payload: RefreshTokenPayload;

        try {
            payload = await this.tokenService.verifyRefreshToken(dto.refreshToken);
        } catch {
            return;
        }

        try {
            await this.sessionService.closeSession(payload.role, payload.sub, payload.jti);
        } catch {
            // Session may not exist or cache may be unavailable — swallowed intentionally.
            // The refresh token will expire naturally via TTL.
        }
    }

    /**
     * Invalidates all active sessions for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async logoutAll(role: AuthUserRole, id: string) {
        await this.sessionService.closeAllSessions(role, id);
    }

    /**
     * Blacklists the access tokens for a principal in the cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async ban(role: AuthUserRole, id: string) {
        await this.sessionService.ban(role, id);
    }

    /**
     * Removes the access token blacklist for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async unban(role: AuthUserRole, id: string) {
        await this.sessionService.unban(role, id);
    }
}
