/**
 * @file handler.ts
 * @description Handles ReInviteAdminCommand. Persists invitation revocation before dispatching a replacement invitation.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { ReInviteAdminCommand } from 'src/module/admin/application/command/re-invite-admin/command';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Re-issues a pending admin's invitation under the aggregate optimistic lock, so a concurrent
 * activation cannot commit using the superseded invitation.
 */
@CommandHandler(ReInviteAdminCommand)
export class ReInviteAdminCommandHandler implements ICommandHandler<ReInviteAdminCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param adminWriterPort The port used to load and persist the admin
     * @param auditPort The port used to record the re-invitation for the audit trail
     */
    constructor(
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
     */
    async execute(command: ReInviteAdminCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        admin.reInvite(command.actor);
        await this.adminWriterPort.save(admin);
        await this.auditPort.record({ action: AuditAction.ADMIN_INVITED, targetId: admin.id });
    }
}
