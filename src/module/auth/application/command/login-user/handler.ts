/**
 * @file handler.ts
 * @description Handles the LoginUserCommand by verifying user credentials, checking account status, creating a new session, and issuing a token pair.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditLogAction, AuditLogPayload, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { AuthRejectionReason } from 'src/module/auth/application/command/auth-rejection-reason.enum';
import { LoginUserCommand, type LoginUserResult } from 'src/module/auth/application/command/login-user/command';
import {
    TOKEN_USER_IDENTITY_READER_PORT,
    type IUserIdentityReaderPort,
} from 'src/module/auth/application/command/port/user-identity-reader.port';
import { UserRole } from 'src/shared/domain/user';
import { ResourceNotFoundException, UnauthenticatedException, UnauthenticatedMessage } from 'src/shared/exception';

/**
 * Handles the LoginUserCommand.
 * Validates user credentials and issues a new session.
 */
@CommandHandler(LoginUserCommand)
export class LoginUserCommandHandler implements ICommandHandler<LoginUserCommand> {
    constructor(
        @Inject(TOKEN_USER_IDENTITY_READER_PORT) private readonly userIdentityReaderPort: IUserIdentityReaderPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
    ) {}

    /**
     * Executes the login user command.
     *
     * @param command The login user command parameters
     * @returns The generated access and refresh tokens
     * @throws {UnauthenticatedException} When credentials are invalid or the account is inactive.
     */
    async execute(command: LoginUserCommand): Promise<LoginUserResult> {
        let user;

        try {
            user = await this.userIdentityReaderPort.getCredentialsByEmail(command.email);
        } catch (error) {
            if (error instanceof ResourceNotFoundException) {
                this.throwUnauthenticatedException(AuthRejectionReason.ACCOUNT_NOT_FOUND);
            }

            throw error;
        }

        if (user.isBanned) {
            this.throwUnauthenticatedException(AuthRejectionReason.INACTIVE_ACCOUNT, user.id);
        }

        if (!(await this.hashingPort.verify(user.password, command.password))) {
            this.throwUnauthenticatedException(AuthRejectionReason.INVALID_PASSWORD, user.id);
        }

        const id = user.id,
            tokens = await this.tokenPort.generateTokens(UserRole.USER, id, user.version);

        await this.sessionPort.openSession(id, tokens.jti);

        this.loggerPort.log(this.createSuccessLogPayload(id));

        return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }

    /**
     * Throws the rejection with the detail of the failed attempt attached. Attaching context is this
     * handler's whole contribution — recording it is the exception filter's job — and it is also what
     * separates a deliberately rejected credential from the routine expired-token `401`s that carry none.
     */
    private throwUnauthenticatedException(reason: AuthRejectionReason, sub?: string): never {
        throw new UnauthenticatedException(UnauthenticatedMessage.CREDENTIALS, {
            context: {
                class: this.constructor.name,
                method: this.execute.name,
                reason,
                sub,
                role: UserRole.USER,
            },
        });
    }

    /**
     * Creates an audit log payload for a successful login.
     */
    private createSuccessLogPayload(sub: string): AuditLogPayload {
        return new AuditLogPayload({
            class: this.constructor.name,
            method: this.execute.name,
            action: AuditLogAction.LOGIN_SUCCESS,
            sub,
            role: UserRole.USER,
        });
    }
}
