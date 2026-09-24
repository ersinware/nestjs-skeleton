/**
 * @file handler.ts
 * @description Verifies the current password and atomically persists an email request, delivery job, and audit.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { RequestAdminEmailChangeCommand } from 'src/module/admin/application/command/request-admin-email-change/command';
import {
    TOKEN_IS_ADMIN_EMAIL_IN_USE_PORT,
    type IIsAdminEmailInUsePort,
} from 'src/module/admin/application/query/is-admin-email-in-use/port';
import { ResourceNotFoundException, isExceptionWithAuditReason } from 'src/shared/exception';

/**
 * Starts a confirmation request without changing the current email or sessions.
 */
@CommandHandler(RequestAdminEmailChangeCommand)
export class RequestAdminEmailChangeCommandHandler implements ICommandHandler<RequestAdminEmailChangeCommand, void> {
    /**
     * Initializes the request dependencies.
     *
     * @param transactionPort Commits account state, delivery, and audit together
     * @param adminWriterPort Loads and saves authoritative account state
     * @param hashingPort Verifies the current password outside the transaction
     * @param emailInUsePort Checks the target against existing account addresses
     * @param auditPort Records the request or failed password proof
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_IS_ADMIN_EMAIL_IN_USE_PORT) private readonly emailInUsePort: IIsAdminEmailInUsePort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Verifies ownership before creating a replacement request.
     *
     * @param command The authenticated account and password proof
     * @throws {ResourceNotFoundException} When the account no longer exists
     * @throws {SystemException} When a deleted or inactive account reaches this authenticated flow
     * @throws {InvalidInputException} When the password is wrong or the address is unchanged
     * @throws {ResourceConflictException} When the address is in use or the loaded account changed
     * @throws {AccessDeniedException} When the account is banned
     */
    async execute(command: RequestAdminEmailChangeCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        try {
            admin.requestEmailChange(
                command.newEmail,
                await this.hashingPort.verify(admin.password, command.password),
                await this.emailInUsePort.isEmailInUse(command.newEmail),
            );
        } catch (error) {
            if (isExceptionWithAuditReason(error)) {
                await this.auditPort.record({
                    action: AuditAction.EMAIL_CHANGE_REQUEST_FAILED,
                    reason: error.auditReason,
                });
            }

            throw error;
        }

        await this.transactionPort.run(async () => {
            await this.adminWriterPort.save(admin);
            await this.auditPort.record({ action: AuditAction.EMAIL_CHANGE_REQUESTED });
        });
    }
}
