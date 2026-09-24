/**
 * @file handler.ts
 * @description Handles ActivateAdminCommand. Verifies the invite token against the account's live state and sets the first password.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { ActivateAdminCommand } from 'src/module/admin/application/command/activate-admin/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import {
    ExceptionKind,
    InvalidInputException,
    isExceptionOfKind,
    isExceptionWithAuditReason,
} from 'src/shared/exception';

/**
 * Audit reasons for activation refusals decided by the handler.
 */
enum ActivateAdminRejectionReason {
    /**
     * The invitation token failed verification.
     */
    INVALID_TOKEN = 'INVALID_TOKEN',

    /**
     * The verified token refers to an account that no longer exists.
     */
    ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
}

/**
 * Activates a pending admin account. Verification is two-layered: the token's signature and expiry,
 * then the persisted invitation and live account state. Activation consumes the invitation metadata
 * while setting the first password.
 */
@CommandHandler(ActivateAdminCommand)
export class ActivateAdminCommandHandler implements ICommandHandler<ActivateAdminCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param adminWriterPort The port used to load and save the admin aggregate
     * @param tokenPort The port used to verify the invite token
     * @param hashingPort The port used to hash the initial password
     * @param auditPort The port used to record activation and refusals
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the activate admin command.
     *
     * @param command The command payload
     * @throws {InvalidInputException} When the invitation is invalid, expired, or no longer applies —
     * one message for every cause, so the endpoint discloses nothing about account state
     */
    async execute(command: ActivateAdminCommand) {
        let payload;

        try {
            payload = await this.tokenPort.verifyInviteToken(command.token);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                throw await this.deny(ActivateAdminRejectionReason.INVALID_TOKEN);
            }

            throw error;
        }

        const admin = await this.adminWriterPort.load(payload.sub);

        if (!admin) {
            throw await this.deny(ActivateAdminRejectionReason.ACCOUNT_NOT_FOUND);
        }

        const password = await this.hashingPort.hash(command.password);

        try {
            admin.activate(password, payload);
        } catch (error) {
            if (isExceptionWithAuditReason(error)) {
                throw await this.deny(error.auditReason, admin.id);
            }

            throw error;
        }

        await this.transactionPort.run(async () => {
            await this.adminWriterPort.save(admin);
            await this.auditPort.record({ action: AuditAction.ADMIN_ACTIVATED, targetId: admin.id });
        });
    }

    /**
     * Records the refusal and builds the uniform client response.
     *
     * @param reason Why the activation was refused
     * @param targetId Existing account rejected by the aggregate
     * @returns The exception the caller throws
     */
    private async deny(reason: string, targetId?: string): Promise<InvalidInputException> {
        await this.auditPort.record({
            action: AuditAction.ADMIN_ACTIVATION_FAILED,
            reason,
            ...(targetId && { targetId }),
        });

        return new InvalidInputException('The invitation is invalid or has expired.');
    }
}
