/**
 * @file handler.ts
 * @description Handles the LoginUserCommand by running the shared credential-login flow against user accounts.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { LoginUserCommand, type LoginUserResult } from 'src/module/auth/application/command/login-user/command';
import { login } from 'src/module/auth/application/command/login.util';
import {
    TOKEN_IDENTITY_READER_PORT,
    type IIdentityReaderPort,
} from 'src/module/auth/application/command/port/identity-reader.port';
import { PrincipalType } from 'src/shared/domain/principal';

/**
 * Handles the LoginUserCommand.
 * A thin DI shell: the flow itself lives in the shared credential-login implementation.
 */
@CommandHandler(LoginUserCommand)
export class LoginUserCommandHandler implements ICommandHandler<LoginUserCommand, LoginUserResult> {
    /**
     * Initializes the handler with the ports the shared login flow runs on.
     *
     * @param identityReaderPort The port used to read the user's credentials
     * @param hashingPort The port used to verify the password
     * @param tokenPort The port used to generate the token pair
     * @param sessionPort The port used to open the refresh session
     * @param auditPort The port used to record the login decision
     */
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
     * @returns A token pair for an activated user, or an activation-required outcome
     * @throws {UnauthenticatedException} When credentials are invalid, the account is inactive, or session registration is superseded.
     * @throws {DependencyUnavailableException} When identity lookup, session registration, or audit persistence is unavailable
     */
    async execute(command: LoginUserCommand): Promise<LoginUserResult> {
        return login(
            {
                identityReaderPort: this.identityReaderPort,
                hashingPort: this.hashingPort,
                tokenPort: this.tokenPort,
                sessionPort: this.sessionPort,
                auditPort: this.auditPort,
            },
            PrincipalType.USER,
            command.email,
            command.password,
        );
    }
}
