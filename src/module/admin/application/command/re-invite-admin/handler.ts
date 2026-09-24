/**
 * @file handler.ts
 * @description Handles ReInviteAdminCommand. Persists invitation revocation before dispatching a replacement invitation.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { ReInviteAdminCommand } from 'src/module/admin/application/command/re-invite-admin/command';
import { ResourceNotFoundException, isExceptionWithAudit } from 'src/shared/exception';

/**
 * Re-issues a pending admin's invitation under the aggregate optimistic lock, so a concurrent
 * activation cannot commit using the superseded invitation.
 */
@CommandHandler(ReInviteAdminCommand)
export class ReInviteAdminCommandHandler implements ICommandHandler<ReInviteAdminCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param adminWriterPort The port used to load and persist the admin
     * @param auditPort The port used to record the re-invitation for the audit trail
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the re-invite admin command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When no non-deleted admin exists with the given ID
     * @throws {ResourceConflictException} When the account is active, banned, or concurrently modified
     * @throws {AccessDeniedException} When the actor cannot administer the target
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {SystemException} When an account or actor invariant is violated, or required jobs are not accepted
     */
    async execute(command: ReInviteAdminCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        try {
            admin.reInvite(command.actor);
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: admin.id }, { markExceptionAsAudited: error });
            }

            throw error;
        }
        await this.transactionPort.run(async () => {
            await this.adminWriterPort.save(admin);
            await this.auditPort.record({ action: AuditAction.ADMIN_INVITED, targetId: admin.id });
        });
    }
}
