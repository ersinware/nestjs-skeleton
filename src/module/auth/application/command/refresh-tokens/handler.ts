/**
 * @file handler.ts
 * @description Handles the RefreshTokenCommand by validating the existing refresh token, checking account active status, managing session lifecycle, and generating a new token pair.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException, UnauthenticatedException, UnauthenticatedType } from 'src/core/exception';
import { AuditLogAction, AuditLogAuthReason, AuditLogPayload } from 'src/core/observability';
import {
    AuthTokenType,
    TOKEN_SESSION_PORT,
    TOKEN_TOKEN_PORT,
    type ISessionPort,
    type ITokenPort,
} from 'src/core/security';
import {
    TOKEN_ADMIN_IDENTITY_READER_PORT,
    TOKEN_USER_IDENTITY_READER_PORT,
    type IAdminIdentityReaderPort,
    type IUserIdentityReaderPort,
} from 'src/module/auth/application/command/port';
import {
    RefreshTokensCommand,
    type RefreshTokensResult,
} from 'src/module/auth/application/command/refresh-tokens/command';
import { UserRole } from 'src/shared/domain/user';

/**
 * Handles the RefreshTokenCommand.
 * Verifies the refresh token, revokes the old session to prevent reuse, and issues a new session pair.
 */
@CommandHandler(RefreshTokensCommand)
export class RefreshTokensCommandHandler implements ICommandHandler<RefreshTokensCommand> {
    constructor(
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_USER_IDENTITY_READER_PORT) private readonly userIdentityReaderPort: IUserIdentityReaderPort,
        @Inject(TOKEN_ADMIN_IDENTITY_READER_PORT)
        private readonly adminIdentityReaderPort: IAdminIdentityReaderPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
    ) {}

    /**
     * Executes the refresh token command.
     *
     * @param command The refresh token command parameters
     * @returns The generated access and refresh tokens
     * @throws {UnauthenticatedException} When the token is invalid, the account is inactive, or a replay attack is detected.
     */
    async execute(command: RefreshTokensCommand): Promise<RefreshTokensResult> {
        let payload;

        try {
            payload = await this.tokenPort.verifyRefreshToken(command.refreshToken);
        } catch {
            throw new UnauthenticatedException();
        }

        if (payload.type !== AuthTokenType.REFRESH) {
            throw new UnauthenticatedException();
        }

        const role = payload.role,
            sub = payload.sub;

        let isActive;
        try {
            isActive =
                role === UserRole.USER
                    ? await this.userIdentityReaderPort.checkIsActive(sub)
                    : await this.adminIdentityReaderPort.checkIsActive(sub);
        } catch (error) {
            if (error instanceof ResourceNotFoundException) {
                this.throwUnauthenticatedException(
                    AuditLogAction.REFRESH_FAILED,
                    AuditLogAuthReason.ACCOUNT_NOT_FOUND,
                    sub,
                    role,
                );
            }

            throw error;
        }

        if (!isActive) {
            this.throwUnauthenticatedException(
                AuditLogAction.REFRESH_FAILED,
                AuditLogAuthReason.INACTIVE_ACCOUNT,
                sub,
                role,
            );
        }

        if (!(await this.sessionPort.getSession(role, sub, payload.jti))) {
            await Promise.all([this.sessionPort.closeAllSessions(role, sub), this.sessionPort.ban(role, sub)]);

            this.throwUnauthenticatedException(AuditLogAction.REPLAY_ATTACK, undefined, sub, role, payload.jti);
        }

        const tokens = await this.tokenPort.generateTokens(role, sub);
        await Promise.all([
            this.sessionPort.closeSession(role, sub, payload.jti),
            this.sessionPort.openSession(role, sub, tokens.jti),
        ]);

        return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }

    /**
     * Throws an UnauthenticatedException with a properly formatted audit log payload.
     */
    private throwUnauthenticatedException(
        action: AuditLogAction,
        reason?: AuditLogAuthReason,
        sub?: string,
        role?: string,
        jti?: string,
    ): never {
        throw new UnauthenticatedException(UnauthenticatedType.DEFAULT, {
            cause: new AuditLogPayload({
                class: this.constructor.name,
                method: this.execute.name,
                action,
                reason,
                sub,
                role,
                jti,
            }),
        });
    }
}
