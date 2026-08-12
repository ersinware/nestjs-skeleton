/**
 * @file handler.ts
 * @description Handles UpdateAdminCommand. Applies profile changes to the Admin aggregate root and persists it.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { UpdateAdminCommand } from 'src/module/admin/application/command/update-admin/command';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Updates profile fields on an existing admin.
 */
@CommandHandler(UpdateAdminCommand)
export class UpdateAdminCommandHandler implements ICommandHandler<UpdateAdminCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param adminWriterPort The port used to load and save the admin aggregate
     * @param auditPort The port used to record the profile change for the audit trail
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the update admin command.
     * When neither email nor name is provided the command is a no-op and returns immediately.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When no active admin exists with the given ID
     */
    async execute(command: UpdateAdminCommand) {
        const { id, email, name } = command;

        if (!email && !name) {
            return;
        }

        const admin = await this.adminWriterPort.load(id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        // `updateProfile` reports whether anything actually changed. On a payload matching the
        // current state there is nothing to persist or audit — an entry for a change that changed
        // nothing would fabricate a fact.
        if (!admin.updateProfile({ ...(name && { name }), ...(email && { email }) })) {
            return;
        }

        await this.adminWriterPort.save(admin);
        this.auditPort.record({ action: AuditAction.ADMIN_UPDATED });
    }
}
