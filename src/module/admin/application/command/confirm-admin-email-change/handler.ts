/**
 * @file handler.ts
 * @description Confirms an admin email change and commits old-address notification evidence atomically.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import {
    ConfirmAdminEmailChangeCommand,
    type ConfirmAdminEmailChangeResult,
} from 'src/module/admin/application/command/confirm-admin-email-change/command';
import {
    TOKEN_ADMIN_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT,
    type IAdminEmailChangeNotificationWriterPort,
} from 'src/module/admin/application/command/port/admin-email-change-notification-writer.port';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { PrincipalType } from 'src/shared/domain/principal';
import {
    ExceptionKind,
    InvalidInputException,
    isExceptionOfKind,
    isExceptionWithAuditReason,
} from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

/**
 * Refusal reasons decided before aggregate validation.
 */
const ConfirmAdminEmailChangeRejectionReason = {
    /**
     * Proof signature, type, expiry or claims failed verification.
     */
    INVALID_TOKEN: 'INVALID_TOKEN',

    /**
     * Verified proof does not belong to the authenticated principal.
     */
    PRINCIPAL_MISMATCH: 'PRINCIPAL_MISMATCH',

    /**
     * Verified proof names an account that no longer exists.
     */
    ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
} as const;

/**
 * Confirms against current primary state; account mutation, delivery, and audit share a commit.
 */
@CommandHandler(ConfirmAdminEmailChangeCommand)
export class ConfirmAdminEmailChangeCommandHandler implements ICommandHandler<
    ConfirmAdminEmailChangeCommand,
    ConfirmAdminEmailChangeResult
> {
    /**
     * Initializes confirmation dependencies.
     *
     * @param transactionPort Commits the account, jobs, notification and audit together
     * @param adminWriterPort Loads and persists authoritative account state
     * @param notificationWriterPort Stores the immutable old-address recipient
     * @param tokenPort Verifies the proof and signs replacement credentials
     * @param sessionPort Registers a replacement session after commit
     * @param auditPort Records completed changes and expected refusals
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_ADMIN_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT)
        private readonly notificationWriterPort: IAdminEmailChangeNotificationWriterPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Confirms the current request and tries to open a replacement session after commit.
     *
     * @param command Authenticated account and emailed token
     * @returns Replacement credentials or an instruction to sign in again
     * @throws {InvalidInputException} When the token or current request is invalid
     * @throws {ResourceConflictException} When the email is taken or the account changed concurrently
     */
    async execute(command: ConfirmAdminEmailChangeCommand): Promise<ConfirmAdminEmailChangeResult> {
        let payload;

        try {
            payload = await this.tokenPort.verifyEmailConfirmationToken(command.token);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                throw await this.deny(ConfirmAdminEmailChangeRejectionReason.INVALID_TOKEN);
            }

            throw error;
        }

        if (payload.sub !== command.id) {
            throw await this.deny(ConfirmAdminEmailChangeRejectionReason.PRINCIPAL_MISMATCH, payload.sub);
        }

        if (payload.principalType !== PrincipalType.ADMIN) {
            throw await this.deny(ConfirmAdminEmailChangeRejectionReason.PRINCIPAL_MISMATCH);
        }

        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            throw await this.deny(ConfirmAdminEmailChangeRejectionReason.ACCOUNT_NOT_FOUND);
        }

        const notification = { id: uuidv7(), aggregateId: admin.id, previousEmail: admin.email };

        try {
            admin.confirmEmailChange(payload, notification.id);
        } catch (error) {
            if (isExceptionWithAuditReason(error)) {
                throw await this.deny(error.auditReason);
            }

            throw error;
        }

        await this.transactionPort.run(async () => {
            await this.adminWriterPort.save(admin);
            await this.notificationWriterPort.save(notification);
            await this.auditPort.record({ action: AuditAction.EMAIL_CHANGED });
        });

        const tokenPairWithSession = await this.tokenPort.generateTokens(
            { id: admin.id, type: PrincipalType.ADMIN, permissions: admin.permissions },
            admin.sessionVersion,
        );

        try {
            if (!(await this.sessionPort.openSession(admin.id, tokenPairWithSession.session))) {
                return { session: 'login_required' };
            }
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.DEPENDENCY_UNAVAILABLE)) {
                return { session: 'login_required' };
            }

            throw error;
        }

        return {
            session: 'created',
            accessToken: tokenPairWithSession.accessToken,
            refreshToken: tokenPairWithSession.refreshToken,
        };
    }

    /**
     * Persists the internal reason and returns the shared client-safe refusal.
     *
     * @param reason Internal refusal reason
     * @param targetId Distinct account named by a mismatched verified proof
     * @returns Uniform invalid confirmation response
     */
    private async deny(reason: string, targetId?: string): Promise<InvalidInputException> {
        await this.auditPort.record({
            action: AuditAction.EMAIL_CHANGE_CONFIRMATION_FAILED,
            reason,
            ...(targetId && { targetId }),
        });

        return new InvalidInputException('The email confirmation is invalid or has expired.');
    }
}
