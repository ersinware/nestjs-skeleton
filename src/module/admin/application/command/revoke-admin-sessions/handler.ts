/**
 * @file handler.ts
 * @description Persists admin session revocation and follow-up jobs.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { RevokeAdminSessionsCommand } from 'src/module/admin/application/command/revoke-admin-sessions/command';
import { AdminAuditAction } from 'src/module/admin/shared/admin-audit';
import { isExceptionWithAudit } from 'src/shared/exception';

/**
 * Coordinates durable revocation of all sessions for an admin.
 */
@CommandHandler(RevokeAdminSessionsCommand)
export class RevokeAdminSessionsCommandHandler implements ICommandHandler<RevokeAdminSessionsCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort Commit boundary for the aggregate, audit, and jobs
     * @param adminWriterPort The port used to load and save the admin aggregate
     * @param auditPort Records completed revocations and any audited aggregate refusal
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Revokes every session for the requested admin.
     *
     * @param command The command payload
     */
    async execute(command: RevokeAdminSessionsCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            return;
        }

        try {
            admin.revokeSessions(command.reason);
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: admin.id }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        await this.transactionPort.join(async () => {
            await this.adminWriterPort.save(admin);
            await this.auditPort.record({
                action: AdminAuditAction.ADMIN_SESSIONS_REVOKED,
                targetId: admin.id,
                detail: {
                    deliveryId: command.deliveryId,
                    reason: command.reason,
                    sessionVersion: String(admin.sessionVersion),
                },
            });
        });
    }
}
