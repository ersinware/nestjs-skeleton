/**
 * @file handler.ts
 * @description Confirms a user email change and commits old-address notification evidence atomically.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { SessionOutcome, TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import {
    ConfirmUserEmailChangeCommand,
    type ConfirmUserEmailChangeResult,
} from 'src/module/user/application/command/confirm-user-email-change/command';
import {
    TOKEN_USER_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT,
    type IUserEmailChangeNotificationWriterPort,
} from 'src/module/user/application/command/port/user-email-change-notification-writer.port';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { AuditReason, DomainFailureAuditAction } from 'src/shared/domain/audit';
import { PrincipalAuditAction, PrincipalType } from 'src/shared/domain/principal';
import {
    AccessDeniedException,
    ExceptionKind,
    InvalidInputException,
    ResourceNotFoundException,
    isExceptionOfKind,
    isExceptionWithAudit,
} from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

/**
 * Confirms against current primary state; account mutation, delivery, and audit share a commit.
 */
@CommandHandler(ConfirmUserEmailChangeCommand)
export class ConfirmUserEmailChangeCommandHandler implements ICommandHandler<
    ConfirmUserEmailChangeCommand,
    ConfirmUserEmailChangeResult
> {
    /**
     * Initializes confirmation dependencies.
     *
     * @param transactionPort Commits the account, jobs, notification and audit together
     * @param userWriterPort Loads and persists authoritative account state
     * @param notificationWriterPort Stores the immutable old-address recipient
     * @param tokenPort Verifies the proof and signs replacement credentials
     * @param sessionPort Registers a replacement session after commit
     * @param auditPort Records completed changes and security refusals
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_USER_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT)
        private readonly notificationWriterPort: IUserEmailChangeNotificationWriterPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Confirms the current request and tries to open a replacement session after commit.
     *
     * @param command Authenticated account and emailed token
     * @returns Replacement credentials or an instruction to sign in again
     * @throws {InvalidInputException} When the proof is invalid or its pending request is revoked, mismatched, consumed, or expired
     * @throws {AccessDeniedException} When the token belongs to another principal or the account is banned
     * @throws {ResourceNotFoundException} When the authenticated account no longer exists
     * @throws {ResourceConflictException} When the email is taken or the account changed concurrently
     * @throws {SystemException} When the loaded account violates the confirmation contract, or the queue does not accept every required job
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     */
    async execute(command: ConfirmUserEmailChangeCommand): Promise<ConfirmUserEmailChangeResult> {
        let payload;

        try {
            payload = await this.tokenPort.verifyEmailConfirmationToken(command.token);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                throw new InvalidInputException('The email confirmation is invalid or has expired.', { cause: error });
            }

            throw error;
        }

        if (payload.sub !== command.id) {
            const error = new AccessDeniedException();

            await this.auditPort.record(
                {
                    action: DomainFailureAuditAction.EMAIL_CHANGE_CONFIRMATION_FAILED,
                    reason: AuditReason.PRINCIPAL_MISMATCH,
                    targetId: payload.sub,
                    detail: { targetPrincipalType: payload.principalType },
                },
                { markExceptionAsAudited: error },
            );

            throw error;
        }

        if (payload.principalType !== PrincipalType.USER) {
            const error = new AccessDeniedException();

            await this.auditPort.record(
                {
                    action: DomainFailureAuditAction.EMAIL_CHANGE_CONFIRMATION_FAILED,
                    reason: AuditReason.PRINCIPAL_MISMATCH,
                    targetId: payload.sub,
                    detail: { targetPrincipalType: payload.principalType },
                },
                { markExceptionAsAudited: error },
            );

            throw error;
        }

        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        const notification = { id: uuidv7(), aggregateId: user.id, previousEmail: user.email };

        try {
            user.confirmEmailChange(payload, notification.id);
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        await this.transactionPort.run(async () => {
            await this.userWriterPort.save(user);
            await this.notificationWriterPort.save(notification);
            await this.auditPort.record({ action: PrincipalAuditAction.EMAIL_CHANGED });
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
