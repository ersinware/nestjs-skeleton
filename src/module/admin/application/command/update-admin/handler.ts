/**
 * @file handler.ts
 * @description Handles UpdateAdminCommand. Applies display-name changes to the Admin aggregate root and persists it.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { UpdateAdminCommand } from 'src/module/admin/application/command/update-admin/command';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Updates the display name on an existing admin.
 */
@CommandHandler(UpdateAdminCommand)
export class UpdateAdminCommandHandler implements ICommandHandler<UpdateAdminCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param adminWriterPort The port used to load and save the admin aggregate
     * @param auditPort The port used to record the profile change for the audit trail
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the update admin command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When no active admin exists with the given ID
     */
    async execute(command: UpdateAdminCommand) {
        const { id, name } = command;

        const admin = await this.adminWriterPort.load(id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        // An unchanged name requires no persistence or mutation audit.
        if (!admin.updateName(name)) {
            return;
        }

        await this.transactionPort.run(async () => {
            await this.adminWriterPort.save(admin);
            await this.auditPort.record({ action: AuditAction.ADMIN_UPDATED });
        });
    }
}
