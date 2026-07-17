/**
 * @file handler.ts
 * @description Handles the LoginAdminCommand by verifying administrator credentials, checking account status, creating a new session, and issuing a token pair.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ResourceNotFoundException, UnauthenticatedException, UnauthenticatedType } from 'src/core/exception';
import {
    AuditLogAction,
    AuditLogAuthReason,
    AuditLogPayload,
    TOKEN_LOGGER_PORT,
    type ILoggerPort,
} from 'src/core/observability';
import {
    TOKEN_HASHING_PORT,
    TOKEN_SESSION_PORT,
    TOKEN_TOKEN_PORT,
    type IHashingPort,
    type ISessionPort,
    type ITokenPort,
} from 'src/core/security';
import { LoginAdminCommand, type LoginAdminResult } from 'src/module/auth/application/command/login-admin/command';
import {
    TOKEN_ADMIN_IDENTITY_READER_PORT,
    type IAdminIdentityReaderPort,
} from 'src/module/auth/application/command/port';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * Handles the LoginAdminCommand.
 * Validates admin credentials and issues a new session.
 */
@CommandHandler(LoginAdminCommand)
export class LoginAdminCommandHandler implements ICommandHandler<LoginAdminCommand> {
    constructor(
        @Inject(TOKEN_ADMIN_IDENTITY_READER_PORT)
        private readonly adminIdentityReaderPort: IAdminIdentityReaderPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
    ) {}

    /**
     * Executes the login admin command.
     *
     * @param command The login admin command parameters
     * @returns The generated access and refresh tokens
     * @throws {UnauthenticatedException} When credentials are invalid or the account is inactive.
     */
    async execute(command: LoginAdminCommand): Promise<LoginAdminResult> {
        let admin;

        try {
            admin = await this.adminIdentityReaderPort.getCredentialsByEmail(command.email);
        } catch (error) {
            if (error instanceof ResourceNotFoundException) {
                this.throwUnauthenticatedException(AuditLogAuthReason.ACCOUNT_NOT_FOUND, undefined, AdminRole.ADMIN);
            }

            throw error;
        }

        if (admin.isBanned) {
            this.throwUnauthenticatedException(AuditLogAuthReason.INACTIVE_ACCOUNT, admin.id, admin.role);
        }

        if (!(await this.hashingPort.verify(admin.password, command.password))) {
            this.throwUnauthenticatedException(AuditLogAuthReason.INVALID_PASSWORD, admin.id, admin.role);
        }

        const id = admin.id,
            role = admin.role,
            tokens = await this.tokenPort.generateTokens(role, id, admin.version);

        await this.sessionPort.openSession(id, tokens.jti);

        this.loggerPort.log(this.createSuccessLogPayload(id, role));

        return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }

    /**
     * Throws an UnauthenticatedException with a properly formatted audit log payload.
     */
    private throwUnauthenticatedException(reason: AuditLogAuthReason, sub: string | undefined, role: AdminRole): never {
        throw new UnauthenticatedException(UnauthenticatedType.CREDENTIALS, {
            cause: new AuditLogPayload({
                class: this.constructor.name,
                method: this.execute.name,
                action: AuditLogAction.LOGIN_FAILED,
                reason,
                sub,
                role,
            }),
        });
    }

    /**
     * Creates an audit log payload for a successful login.
     */
    private createSuccessLogPayload(sub: string, role: AdminRole): AuditLogPayload {
        return new AuditLogPayload({
            class: this.constructor.name,
            method: this.execute.name,
            action: AuditLogAction.LOGIN_SUCCESS,
            sub,
            role,
        });
    }
}
