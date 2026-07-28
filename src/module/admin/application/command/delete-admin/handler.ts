/**
 * @file handler.ts
 * @description Handles the DeleteAdminCommand by revoking sessions, preventing super-admin deletion, and soft-deleting the entity.
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
 * Handler for the DeleteAdminCommand.
 * Soft-deletes an admin account while enforcing authorization rules.
 */
@CommandHandler(DeleteAdminCommand)
export class DeleteAdminCommandHandler implements ICommandHandler<DeleteAdminCommand> {
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
     * Executes the delete admin command.
     *
     * @param command The delete admin command parameters
     * @throws {ResourceNotFoundException} When the target admin does not exist.
     * @throws {AccessDeniedException} When attempting to delete a super administrator.
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

        // Unconditional: the writer's `load()` filters out soft-deleted rows, so reaching here means
        // the account was live and the transition genuinely happened.
        this.auditPort.record({ action: AuditAction.ADMIN_DELETED, targetId: command.id });

        try {
            await this.sessionPort.setVersion(command.id, admin.version);
        } catch {
            // Best-effort instant eviction.
        }
    }
}
