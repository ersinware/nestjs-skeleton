/**
 * @file handler.ts
 * @description Handles InviteAdminCommand. Creates and persists a passwordless Admin aggregate whose durable job triggers the invitation email.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { InviteAdminCommand } from 'src/module/admin/application/command/invite-admin/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { AdminAuditAction } from 'src/module/admin/shared/admin-audit';
import { isExceptionWithAudit } from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

/**
 * Invites a new admin with a pending account and durable invitation delivery.
 */
@CommandHandler(InviteAdminCommand)
export class InviteAdminCommandHandler implements ICommandHandler<InviteAdminCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param adminWriterPort The port used to persist the admin aggregate
     * @param auditPort The port used to record the pending account creation for the audit trail
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the admin invitation command.
     *
     * @param command The command payload
     * @throws {ResourceConflictException} When the email address is already in use
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When the delivery queue does not accept every required job
     */
    async execute(command: InviteAdminCommand) {
        const id = uuidv7();

        let admin;

        try {
            admin = Admin.create({
                id,
                email: command.email,
                name: command.name,
                password: null,
            });
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        await this.transactionPort.run(async () => {
            await this.adminWriterPort.save(admin);
            await this.auditPort.record({ action: AdminAuditAction.ADMIN_CREATED, targetId: admin.id });
        });
    }
}
