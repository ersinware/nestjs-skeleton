/**
 * @file handler.ts
 * @description Handles the UnbanAdminCommand by lifting the ban on the admin account, preventing changes to super-admins.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { UnbanAdminCommand } from 'src/module/admin/application/command/unban-admin/command';
import { AdminRole } from 'src/shared/domain/admin';
import { AccessDeniedException, ResourceNotFoundException } from 'src/shared/exception';

/**
 * Handler for the UnbanAdminCommand.
 * Lifts the ban on the admin account while enforcing authorization rules. Unlike banning, no session
 * eviction is needed: the version is monotonic and a fresh login mints a token at the current version.
 */
@CommandHandler(UnbanAdminCommand)
export class UnbanAdminCommandHandler implements ICommandHandler<UnbanAdminCommand> {
    constructor(@Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort) {}

    /**
     * Executes the unban admin command.
     *
     * @param command The unban admin command parameters
     * @throws {ResourceNotFoundException} When the target admin does not exist.
     * @throws {AccessDeniedException} When attempting to change the status of a super administrator.
     */
    async execute(command: UnbanAdminCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        if (admin.role === AdminRole.SUPER_ADMIN) {
            throw new AccessDeniedException();
        }

        admin.unban();
        await this.adminWriterPort.save(admin);
    }
}
