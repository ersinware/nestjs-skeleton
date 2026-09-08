/**
 * @file handler.ts
 * @description Handles CreateAdminCommand. Creates and persists a passwordless Admin aggregate, whose INVITED event triggers the invitation email.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { CreateAdminCommand } from 'src/module/admin/application/command/create-admin/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { uuidv7 } from 'uuidv7';

/**
 * Creates a new admin account pending activation.
 */
@CommandHandler(CreateAdminCommand)
export class CreateAdminCommandHandler implements ICommandHandler<CreateAdminCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param adminWriterPort The port used to persist the admin aggregate
     * @param auditPort The port used to record the creation for the audit trail
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the create admin command.
     *
     * @param command The command payload
     * @throws {ResourceConflictException} When the email address is already in use
     */
    async execute(command: CreateAdminCommand) {
        const admin = Admin.create({
            id: uuidv7(),
            email: command.email,
            name: command.name,
            password: null,
        });

        await this.adminWriterPort.save(admin);
        await this.auditPort.record({ action: AuditAction.ADMIN_CREATED, targetId: admin.id });
    }
}
