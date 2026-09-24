/**
 * @file handler.ts
 * @description Confirms a user email change and commits old-address notification evidence atomically.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
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
const ConfirmUserEmailChangeRejectionReason = {
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
     * @param auditPort Records completed changes and expected refusals
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
     * @throws {InvalidInputException} When the token or current request is invalid
     * @throws {ResourceConflictException} When the email is taken or the account changed concurrently
     */
    async execute(command: ConfirmUserEmailChangeCommand): Promise<ConfirmUserEmailChangeResult> {
        let payload;

        try {
            payload = await this.tokenPort.verifyEmailConfirmationToken(command.token);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                throw await this.deny(ConfirmUserEmailChangeRejectionReason.INVALID_TOKEN);
            }

            throw error;
        }

        if (payload.sub !== command.id) {
            throw await this.deny(ConfirmUserEmailChangeRejectionReason.PRINCIPAL_MISMATCH, payload.sub);
        }

        if (payload.principalType !== PrincipalType.USER) {
            throw await this.deny(ConfirmUserEmailChangeRejectionReason.PRINCIPAL_MISMATCH);
        }

        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            throw await this.deny(ConfirmUserEmailChangeRejectionReason.ACCOUNT_NOT_FOUND);
        }

        const notification = { id: uuidv7(), aggregateId: user.id, previousEmail: user.email };

        try {
            user.confirmEmailChange(payload, notification.id);
        } catch (error) {
            if (isExceptionWithAuditReason(error)) {
                throw await this.deny(error.auditReason);
            }

            throw error;
        }

        await this.transactionPort.run(async () => {
            await this.userWriterPort.save(user);
            await this.notificationWriterPort.save(notification);
            await this.auditPort.record({ action: AuditAction.EMAIL_CHANGED });
        });

        const tokenPairWithSession = await this.tokenPort.generateTokens(
            { id: user.id, type: PrincipalType.USER, permissions: user.permissions },
            user.sessionVersion,
        );

        try {
            if (!(await this.sessionPort.openSession(user.id, tokenPairWithSession.session))) {
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
