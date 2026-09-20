/**
 * @file handler.ts
 * @description Persists admin session revocation, audit evidence, and follow-up jobs.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { RevokeAdminSessionsCommand } from 'src/module/admin/application/command/revoke-admin-sessions/command';

/**
 * Coordinates durable revocation of all sessions for an admin.
 */
@CommandHandler(RevokeAdminSessionsCommand)
export class RevokeAdminSessionsCommandHandler implements ICommandHandler<RevokeAdminSessionsCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort Commit boundary for the aggregate, jobs, and audit
     * @param adminWriterPort The port used to load and save the admin aggregate
     * @param auditPort The port used to record the revocation
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

        admin.revokeSessions(command.reason);

        await this.transactionPort.run(async () => {
            await Promise.all([
                this.adminWriterPort.save(admin),
                this.auditPort.record({ action: AuditAction.ADMIN_SESSIONS_REVOKED, targetId: admin.id }),
            ]);
        });
    }
}
