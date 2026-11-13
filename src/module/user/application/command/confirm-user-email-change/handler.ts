/**
 * @file handler.ts
 * @description Confirms a user email change and commits old-address notification evidence atomically.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_IDEMPOTENCY_PORT, type IIdempotencyPort } from 'src/core/idempotency';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    EMAIL_CONFIRMATION_TOKEN_TYPE,
    TOKEN_EMAIL_CONFIRMATION_TOKEN_PORT,
    type EmailConfirmationTokenPayload,
} from 'src/core/security/email-change';
import type { ITokenPort } from 'src/core/security/token';
import { ConfirmUserEmailChangeCommand } from 'src/module/user/application/command/confirm-user-email-change/command';
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
export class ConfirmUserEmailChangeCommandHandler implements ICommandHandler<ConfirmUserEmailChangeCommand, void> {
    /**
     * Initializes confirmation dependencies.
     *
     * @param idempotencyPort Commits the account, jobs, notification and audit together
     * @param userWriterPort Loads and persists authoritative account state
     * @param notificationWriterPort Stores the immutable old-address recipient
     * @param emailConfirmationTokenPort Verifies the email confirmation proof
     * @param auditPort Records completed changes and security refusals
     */
    constructor(
        @Inject(TOKEN_IDEMPOTENCY_PORT) private readonly idempotencyPort: IIdempotencyPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_USER_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT)
        private readonly notificationWriterPort: IUserEmailChangeNotificationWriterPort,
        @Inject(TOKEN_EMAIL_CONFIRMATION_TOKEN_PORT)
        private readonly emailConfirmationTokenPort: ITokenPort<typeof EMAIL_CONFIRMATION_TOKEN_TYPE>,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Confirms the current request and requires a new sign-in after commit.
     *
     * @param command Authenticated account and emailed token
     * @throws {InvalidInputException} When the proof is invalid or its pending request is revoked, mismatched, consumed, or expired
     * @throws {AccessDeniedException} When the token belongs to another principal or the account is banned
     * @throws {ResourceNotFoundException} When the authenticated account no longer exists
     * @throws {ResourceConflictException} When the key belongs to a different request or persistence rejects a conflicting mutation.
     * @throws {SystemException} When the loaded account violates the confirmation contract, or the queue does not accept every required job
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     */
    async execute(command: ConfirmUserEmailChangeCommand) {
        await this.idempotencyPort.executePrepared(
            command.idempotencyRequest,
            async () => {
                let payload: EmailConfirmationTokenPayload;

                try {
                    payload = await this.emailConfirmationTokenPort.verify<EmailConfirmationTokenPayload>(
                        command.token,
                        EMAIL_CONFIRMATION_TOKEN_TYPE,
                    );
                } catch (error) {
                    if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                        throw new InvalidInputException('The email confirmation is invalid or has expired.', {
                            cause: error,
                        });
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

                return { user, payload };
            },
            async ({ user, payload }) => {
                const notificationId = uuidv7(),
                    previousEmail = user.email;

                try {
                    user.confirmEmailChange(payload, notificationId);
                } catch (error) {
                    if (isExceptionWithAudit(error)) {
                        await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
                    }

                    throw error;
                }

                await this.userWriterPort.save(user);
                await this.notificationWriterPort.save({
                    id: notificationId,
                    aggregateId: user.id,
                    previousEmail,
                });
                await this.auditPort.record({ action: PrincipalAuditAction.EMAIL_CHANGED });

                return { replayResultId: null };
            },
        );
    }
}
