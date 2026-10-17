/**
 * @file handler.ts
 * @description Verifies user activation proof, commits the activation, and opens a session afterward.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { SessionOutcome, TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import {
    ActivateUserCommand,
    type ActivateUserResult,
} from 'src/module/user/application/command/activate-user/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { PrincipalType } from 'src/shared/domain/principal';
import {
    ExceptionKind,
    InvalidInputException,
    ResourceNotFoundException,
    isExceptionOfKind,
    isExceptionWithAudit,
} from 'src/shared/exception';

/**
 * Activates against current primary account state and opens a session only after commit.
 */
@CommandHandler(ActivateUserCommand)
export class ActivateUserCommandHandler implements ICommandHandler<ActivateUserCommand, ActivateUserResult> {
    /**
     * Initializes activation dependencies.
     *
     * @param transactionPort Commits the account state and success audit together
     * @param userWriterPort Loads and persists authoritative account state
     * @param tokenPort Verifies the proof and signs session credentials
     * @param hashingPort Verifies the existing password without replacing its hash
     * @param sessionPort Registers a new session after commit
     * @param auditPort Records completed activations and audited refusals
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Consumes the activation proof and tries to open a session for the activated account.
     *
     * @param command Emailed token and existing password
     * @returns New credentials or an instruction to sign in again
     * @throws {InvalidInputException} When the proof is invalid, expired, revoked, or the password is wrong
     * @throws {ResourceNotFoundException} When the verified proof refers to a missing account
     * @throws {AccessDeniedException} When the account is banned
     * @throws {ResourceConflictException} When the account is already active or changed concurrently
     * @throws {SystemException} When the loaded account is deleted or differs from the verified subject
     * @throws {DependencyUnavailableException} When required database or audit persistence is unavailable
     */
    async execute(command: ActivateUserCommand): Promise<ActivateUserResult> {
        let payload;

        try {
            payload = await this.tokenPort.verifyActivationToken(command.token);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                throw new InvalidInputException('The activation link is invalid or has expired.', { cause: error });
            }

            throw error;
        }

        const user = await this.userWriterPort.load(payload.sub);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        try {
            user.activate(payload, await this.hashingPort.verify(user.password, command.password));
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: user.id }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        await this.transactionPort.run(async () => {
            await this.userWriterPort.save(user);
            await this.auditPort.record({ action: AuditAction.USER_ACTIVATED, targetId: user.id });
        });

        const tokenPairWithSession = await this.tokenPort.generateTokens(
            { id: user.id, type: PrincipalType.USER, permissions: user.permissions },
            user.sessionVersion,
        );

        try {
            if (!(await this.sessionPort.openSession(user.id, tokenPairWithSession.session))) {
                return { session: SessionOutcome.LOGIN_REQUIRED };
            }
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.DEPENDENCY_UNAVAILABLE)) {
                return { session: SessionOutcome.LOGIN_REQUIRED };
            }

            throw error;
        }

        return {
            session: SessionOutcome.CREATED,
            accessToken: tokenPairWithSession.accessToken,
            refreshToken: tokenPairWithSession.refreshToken,
        };
    }
}
