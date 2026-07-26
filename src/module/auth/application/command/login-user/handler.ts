/**
 * @file handler.ts
 * @description Handles the LoginUserCommand by verifying user credentials, checking account status, creating a new session, and issuing a token pair.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { AuthRejectionReason } from 'src/module/auth/application/command/auth-rejection-reason.enum';
import { LoginUserCommand, type LoginUserResult } from 'src/module/auth/application/command/login-user/command';
import {
    IdentityRealm,
    TOKEN_IDENTITY_READER_PORT,
    type IIdentityReaderPort,
} from 'src/module/auth/application/command/port/identity-reader.port';
import { ResourceNotFoundException, UnauthenticatedException, UnauthenticatedMessage } from 'src/shared/exception';

/**
 * Handles the LoginUserCommand.
 * Validates user credentials and issues a new session.
 */
@CommandHandler(LoginUserCommand)
export class LoginUserCommandHandler implements ICommandHandler<LoginUserCommand> {
    constructor(
        @Inject(TOKEN_IDENTITY_READER_PORT) private readonly identityReaderPort: IIdentityReaderPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
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
            user = await this.identityReaderPort.getCredentialsByEmail(IdentityRealm.USER, command.email);
        } catch (error) {
            if (error instanceof ResourceNotFoundException) {
                throw this.denyLogin(AuthRejectionReason.ACCOUNT_NOT_FOUND);
            }

            throw error;
        }

        if (user.isBanned) {
            throw this.denyLogin(AuthRejectionReason.INACTIVE_ACCOUNT, user.id);
        }

        if (!(await this.hashingPort.verify(user.password, command.password))) {
            throw this.denyLogin(AuthRejectionReason.INVALID_PASSWORD, user.id);
        }

        const id = user.id,
            tokens = await this.tokenPort.generateTokens(user.role, id, user.version);

        await this.sessionPort.openSession(id, tokens.jti);

        this.auditPort.record({ action: AuditAction.LOGIN_SUCCESS, targetId: id });

        return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }

    /**
     * Records the failed attempt and builds the rejection the caller throws.
     *
     * This handler is the only code that knows WHY the attempt failed — the response deliberately
     * says nothing beyond "credentials", so an observer downstream cannot tell an unknown email from
     * a wrong password. Writing the audit record here rather than attaching the reason as exception
     * `context` is what keeps the two apart: the auditor gets the precise reason, the client gets none.
     *
     * The exception therefore carries NO context. Context is a diagnostic channel read on 5xx; a
     * deliberate 401 that has already been audited has nothing left to say to an operator, and
     * leaving it attached would duplicate the same event into the operational log as a `warn`.
     *
     * @param reason Why the attempt was rejected — the audit record's own vocabulary
     * @param sub The rejected account's id, absent when no account matched the email
     * @returns The exception the caller throws
     */
    private denyLogin(reason: AuthRejectionReason, sub?: string): UnauthenticatedException {
        this.auditPort.record({ action: AuditAction.LOGIN_FAILED, reason, targetId: sub });

        return new UnauthenticatedException(UnauthenticatedMessage.CREDENTIALS);
    }
}
