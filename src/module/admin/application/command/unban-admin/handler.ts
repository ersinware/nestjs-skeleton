/**
 * @file handler.ts
 * @description Handler for UnbanAdminCommand.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { UnbanAdminCommand } from 'src/module/admin/application/command/unban-admin/command';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Lifts the ban on the admin account. Unlike banning, no session eviction is needed: the session
 * version is monotonic and a fresh login mints a token at the current version.
 */
@CommandHandler(UnbanAdminCommand)
export class UnbanAdminCommandHandler implements ICommandHandler<UnbanAdminCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param adminWriterPort The port used to load and persist the admin aggregate
     * @param auditPort The port used to record the unban
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the unban.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the target admin does not exist.
     * @throws {AccessDeniedException} When the actor targets themselves or root, or a manager without being root.
     */
    async execute(command: UnbanAdminCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        // `unban()` reports whether the account actually transitioned. On an account that is not
        // banned there is nothing to persist or audit — an entry for a ban that was never in place
        // would fabricate a fact.
        if (!admin.unban(command.actor)) {
            return;
        }

        await this.transactionPort.run(async () => {
            await this.adminWriterPort.save(admin);
            await this.auditPort.record({ action: AuditAction.ADMIN_UNBANNED, targetId: admin.id });
        });
    }
}
