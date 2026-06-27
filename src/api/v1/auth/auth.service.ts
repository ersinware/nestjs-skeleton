/**
 * @file auth.service.ts
 * @description Contains the core business logic for authentication. Orchestrates credential verification, token generation, session management, and strict replay attack detection by bridging multiple domain services.
 */

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { TOKEN_LOGGER_SERVICE } from 'src/common/port/logger/logger.constant';
import type { ILoggerService } from 'src/common/port/logger/logger.service.interface';
import type { IHashingService } from 'src/common/port/security/hashing.service.interface';
import { TOKEN_HASHING_SERVICE } from 'src/common/port/security/hashing.constant';
import { UnauthorizedType } from 'src/common/exception/enum/unauthorized-type.enum';
import { AuthTokenType } from 'src/common/auth/enum/auth-token-type.enum';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { RefreshTokenPayload } from 'src/common/auth/interface/refresh-token-payload.interface';
import { TOKEN_ADMIN_IDENTITY_PROVIDER, TOKEN_USER_IDENTITY_PROVIDER } from './constant/auth.constant';
import type { IAuthIdentity, IAuthAdminIdentity } from './interface/auth-identity.interface';
import type { IIdentityProvider } from './interface/identity-provider.interface';
import { PostAuthLoginDto } from './dto/post-auth-login.dto';
import { AuditLogAction } from 'src/common/port/logger/enum/audit-log-action.enum';
import { AuditLogAuthReason } from 'src/common/port/logger/enum/audit-log-auth-reason.enum';
import { PostAuthRefreshDto } from './dto/post-auth-refresh.dto';
import { TOKEN_SESSION_SERVICE } from 'src/common/port/security/session.constant';
import type { ISessionService } from 'src/common/port/security/session.service.interface';
import { TOKEN_TOKEN_SERVICE } from 'src/common/port/security/token.constant';
import type { ITokenService } from 'src/common/port/security/token.service.interface';
import * as Sentry from '@sentry/nestjs';
import { AuditLogPayload } from 'src/common/port/logger/payload/audit-log-payload';
import { LogPayload } from 'src/common/port/logger/payload/log-payload';

/**
 * The service orchestrating authentication workflows, token lifecycles, and session state.
 * Acts as the centralized authority for verifying identities and enforcing security policies during login and refresh operations.
 */
@Injectable()
export class AuthService {
    /**
     * Injects the necessary dependencies for cross-domain authentication logic.
     *
     * @param userProvider The service providing user domain identity lookups
     * @param adminProvider The service providing admin domain identity lookups
     * @param tokenService The service responsible for generating and verifying JWTs
     * @param sessionService The service managing stateful session storage in cache
     * @param hashingService The utility service for verifying password hashes
     * @param logger The centralized logging service for audit trails
     */
    constructor(
        @Inject(TOKEN_USER_IDENTITY_PROVIDER) private readonly userProvider: IIdentityProvider,
        @Inject(TOKEN_ADMIN_IDENTITY_PROVIDER) private readonly adminProvider: IIdentityProvider<IAuthAdminIdentity>,
        @Inject(TOKEN_TOKEN_SERVICE) private readonly tokenService: ITokenService,
        @Inject(TOKEN_SESSION_SERVICE) private readonly sessionService: ISessionService,
        @Inject(TOKEN_HASHING_SERVICE) private readonly hashingService: IHashingService,
        @Inject(TOKEN_LOGGER_SERVICE) private readonly logger: ILoggerService,
    ) {}

    /**
     * Verifies standard user credentials, opens a new cache session, and issues authentication tokens.
     * Generates structured audit logs for both successful and failed attempts to monitor security events.
     *
     * @param dto The payload containing the user's login credentials
     * @returns The generated access and refresh token pair
     * @throws {UnauthorizedException} If the account is not found, inactive, or the password is incorrect
     */
    async loginUser(dto: PostAuthLoginDto): Promise<{ accessToken: string; refreshToken: string }> {
        let user: IAuthIdentity;

        try {
            user = await this.userProvider.findByEmail(dto.email);
        } catch {
            throw new UnauthorizedException(UnauthorizedType.CREDENTIALS, {
                cause: new AuditLogPayload({
                    class: this.constructor.name,
                    method: this.loginUser.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.ACCOUNT_NOT_FOUND,
                    sub: undefined,
                    role: AuthUserRole.USER,
                }),
            });
        }

        if (!user.isActive) {
            throw new UnauthorizedException(UnauthorizedType.CREDENTIALS, {
                cause: new AuditLogPayload({
                    class: this.constructor.name,
                    method: this.loginUser.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.INACTIVE_ACCOUNT,
                    sub: user.id,
                    role: AuthUserRole.USER,
                }),
            });
        }

        if (!(await this.hashingService.verify(user.password, dto.password))) {
            throw new UnauthorizedException(UnauthorizedType.CREDENTIALS, {
                cause: new AuditLogPayload({
                    class: this.constructor.name,
                    method: this.loginUser.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.INVALID_PASSWORD,
                    sub: user.id,
                    role: AuthUserRole.USER,
                }),
            });
        }

        const id = user.id,
            tokens = await this.tokenService.generateTokens(AuthUserRole.USER, id);

        await this.sessionService.openSession(AuthUserRole.USER, id, tokens.jti);

        this.logger.log(
            new AuditLogPayload({
                class: this.constructor.name,
                method: this.loginUser.name,
                action: AuditLogAction.LOGIN_SUCCESS,
                sub: id,
                role: AuthUserRole.USER,
            }),
        );

        return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }

    /**
     * Verifies administrative credentials, opens a new cache session, and issues authentication tokens.
     * Operates similarly to user login but targets the admin domain to enforce strict back-office access.
     *
     * @param dto The payload containing the admin's login credentials
     * @returns The generated access and refresh token pair
     * @throws {UnauthorizedException} If the account is not found, inactive, or the password is incorrect
     */
    async loginAdmin(dto: PostAuthLoginDto): Promise<{ accessToken: string; refreshToken: string }> {
        let admin: IAuthAdminIdentity;

        try {
            admin = await this.adminProvider.findByEmail(dto.email);
        } catch {
            throw new UnauthorizedException(UnauthorizedType.CREDENTIALS, {
                cause: new AuditLogPayload({
                    class: this.constructor.name,
                    method: this.loginAdmin.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.ACCOUNT_NOT_FOUND,
                    sub: undefined,
                    role: AuthUserRole.ADMIN,
                }),
            });
        }

        if (!admin.isActive) {
            throw new UnauthorizedException(UnauthorizedType.CREDENTIALS, {
                cause: new AuditLogPayload({
                    class: this.constructor.name,
                    method: this.loginAdmin.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.INACTIVE_ACCOUNT,
                    sub: admin.id,
                    role: AuthUserRole.ADMIN,
                }),
            });
        }

        if (!(await this.hashingService.verify(admin.password, dto.password))) {
            throw new UnauthorizedException(UnauthorizedType.CREDENTIALS, {
                cause: new AuditLogPayload({
                    class: this.constructor.name,
                    method: this.loginAdmin.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.INVALID_PASSWORD,
                    sub: admin.id,
                    role: AuthUserRole.ADMIN,
                }),
            });
        }

        const id = admin.id,
            role = admin.role,
            tokens = await this.tokenService.generateTokens(role, id);

        await this.sessionService.openSession(role, id, tokens.jti);

        this.logger.log(
            new AuditLogPayload({
                class: this.constructor.name,
                method: this.loginAdmin.name,
                action: AuditLogAction.LOGIN_SUCCESS,
                sub: id,
                role,
            }),
        );

        return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }

    /**
     * Rotates a valid refresh token, issuing a new credential pair to maintain the session.
     * Implements strict replay attack detection: if a valid but previously used refresh token is presented, it assumes the token was compromised and immediately revokes all sessions for that principal.
     *
     * @param dto The payload containing the current refresh token
     * @returns The newly generated access and refresh token pair
     * @throws {UnauthorizedException} If the token is invalid, expired, or a replay attack is detected
     */
    async refresh(dto: PostAuthRefreshDto): Promise<{ accessToken: string; refreshToken: string }> {
        let payload: RefreshTokenPayload;

        try {
            payload = await this.tokenService.verifyRefreshToken(dto.refreshToken);
        } catch {
            throw new UnauthorizedException(UnauthorizedType.DEFAULT);
        }

        if (payload.type !== AuthTokenType.REFRESH) {
            throw new UnauthorizedException(UnauthorizedType.DEFAULT);
        }

        const role = payload.role,
            sub = payload.sub;

        // Replay Attack detection (JTI is not active in the cache but token signature is valid)
        const storedJti = await this.sessionService.getSession(role, sub, payload.jti);
        if (!storedJti) {
            await this.sessionService.closeAllSessions(role, sub);
            await this.sessionService.ban(role, sub);

            throw new UnauthorizedException(UnauthorizedType.DEFAULT, {
                cause: new AuditLogPayload({
                    class: this.constructor.name,
                    method: this.refresh.name,
                    action: AuditLogAction.REPLAY_ATTACK,
                    sub,
                    role,
                    jti: payload.jti,
                }),
            });
        }

        await this.sessionService.closeSession(role, sub, payload.jti);

        let identity: IAuthIdentity;

        try {
            identity =
                role === AuthUserRole.USER
                    ? await this.userProvider.findById(sub)
                    : await this.adminProvider.findById(sub);
        } catch {
            throw new UnauthorizedException(UnauthorizedType.DEFAULT, {
                cause: new AuditLogPayload({
                    class: this.constructor.name,
                    method: this.refresh.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.ACCOUNT_NOT_FOUND,
                    sub,
                    role,
                }),
            });
        }

        if (!identity.isActive) {
            throw new UnauthorizedException(UnauthorizedType.DEFAULT, {
                cause: new AuditLogPayload({
                    class: this.constructor.name,
                    method: this.refresh.name,
                    action: AuditLogAction.LOGIN_FAILED,
                    reason: AuditLogAuthReason.INACTIVE_ACCOUNT,
                    sub,
                    role,
                }),
            });
        }

        const tokens = await this.tokenService.generateTokens(role, sub);

        await this.sessionService.openSession(role, sub, tokens.jti);

        return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }

    /**
     * Invalidates a specific session by removing its tracking ID (JTI) from the cache.
     * Fails silently if the token is already invalid to prevent enumeration attacks, but logs critical cache failures to Sentry.
     *
     * @param dto The payload containing the refresh token to invalidate
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
        } catch (error) {
            const _error = error instanceof Error ? error : new Error(String(error));

            this.logger.error(
                new LogPayload({
                    class: this.constructor.name,
                    method: this.logout.name,
                    error: _error,
                }),
            );
            Sentry.captureException(_error);
        }
    }

    /**
     * Invalidates all active sessions for a given principal across all devices.
     * Used during critical security events like password resets or compromised account remediation.
     *
     * @param role The authorization role of the principal
     * @param id The unique identifier of the principal
     */
    async logoutAll(role: AuthUserRole, id: string) {
        await this.sessionService.closeAllSessions(role, id);
    }

    /**
     * Explicitly blocklists a principal, ensuring even unexpired access tokens are rejected.
     * Provides an immediate cutoff mechanism independent of the standard token expiration lifecycle.
     *
     * @param role The authorization role of the principal
     * @param id The unique identifier of the principal
     */
    async ban(role: AuthUserRole, id: string) {
        await this.sessionService.ban(role, id);
    }
}
