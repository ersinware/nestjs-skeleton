/**
 * @file handler.ts
 * @description Handler for DeleteAdminCommand.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { DeleteAdminCommand } from 'src/module/admin/application/command/delete-admin/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { AdminRole } from 'src/shared/domain/admin';
import { AccessDeniedException, ResourceNotFoundException } from 'src/shared/exception';

/**
 * Soft-deletes the admin account and revokes all of its active sessions. Super-admins cannot be
 * deleted, so the system can never lock itself out.
 */
@CommandHandler(DeleteAdminCommand)
export class DeleteAdminCommandHandler implements ICommandHandler<DeleteAdminCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param adminWriterPort The port used to load and persist the admin aggregate
     * @param sessionPort The port used to revoke the admin's sessions
     * @param auditPort The port used to record the deletion
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the deletion.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the target admin does not exist.
     * @throws {AccessDeniedException} When the target is a super-admin.
     */
    async execute(command: DeleteAdminCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        if (admin.role === AdminRole.SUPER_ADMIN) {
            throw new AccessDeniedException();
        }

        admin.markAsDeleted();
        await this.adminWriterPort.save(admin);
        await this.auditPort.record({ action: AuditAction.ADMIN_DELETED, targetId: admin.id });

        // Best-effort instant eviction, fire-and-forget: the DB version already denies the next
        // refresh, so the response does not wait on Redis. The catch only stops an unhandled rejection.
        this.sessionPort.setVersion(admin.id, admin.sessionVersion).catch(() => {});
    }
}
