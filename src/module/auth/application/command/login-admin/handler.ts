/**
 * @file handler.ts
 * @description Handles the LoginAdminCommand by verifying administrator credentials, checking account status, creating a new session, and issuing a token pair.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditLogAction, AuditLogPayload, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { AuthRejectionReason } from 'src/module/auth/application/command/auth-rejection-reason.enum';
import { LoginAdminCommand, type LoginAdminResult } from 'src/module/auth/application/command/login-admin/command';
import {
    TOKEN_ADMIN_IDENTITY_READER_PORT,
    type IAdminIdentityReaderPort,
} from 'src/module/auth/application/command/port/admin-identity-reader.port';
import { AdminRole } from 'src/shared/domain/admin';
import { ResourceNotFoundException, UnauthenticatedException, UnauthenticatedMessage } from 'src/shared/exception';

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
                throw this.createUnauthenticatedException(AuthRejectionReason.ACCOUNT_NOT_FOUND, AdminRole.ADMIN);
            }

            throw error;
        }

        if (admin.isBanned) {
            throw this.createUnauthenticatedException(AuthRejectionReason.INACTIVE_ACCOUNT, admin.role, admin.id);
        }

        if (!(await this.hashingPort.verify(admin.password, command.password))) {
            throw this.createUnauthenticatedException(AuthRejectionReason.INVALID_PASSWORD, admin.role, admin.id);
        }

        const id = admin.id,
            role = admin.role,
            tokens = await this.tokenPort.generateTokens(role, id, admin.version);

        await this.sessionPort.openSession(id, tokens.jti);

        this.loggerPort.log(this.createSuccessLogPayload(id, role));

        return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }

    /**
     * Builds the rejection with the detail of the failed attempt attached. Attaching context is this
     * handler's whole contribution — recording it is the exception filter's job — and it is also what
     * separates a deliberately rejected credential from the routine expired-token `401`s that carry none.
     *
     * @param reason Why the attempt was rejected, recorded for the audit log
     * @param role The rejected account's role, falling back to the endpoint's own role when no account matched the email
     * @param sub The rejected account's id, absent when no account matched the email
     * @returns The exception the caller throws
     */
    private createUnauthenticatedException(
        reason: AuthRejectionReason,
        role: AdminRole,
        sub?: string,
    ): UnauthenticatedException {
        return new UnauthenticatedException(UnauthenticatedMessage.CREDENTIALS, {
            context: {
                class: this.constructor.name,
                method: this.execute.name,
                reason,
                sub,
                role,
            },
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
