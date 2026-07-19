/**
 * @file handler.ts
 * @description Handles the BanAdminCommand by banning the admin account, preventing bans on super-admins.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { BanAdminCommand } from 'src/module/admin/application/command/ban-admin/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { AdminRole } from 'src/shared/domain/admin';
import { AccessDeniedException, ResourceNotFoundException } from 'src/shared/exception';

/**
 * Handler for the BanAdminCommand.
 * Bans the admin account while enforcing authorization rules, revoking all of its active sessions.
 */
@CommandHandler(BanAdminCommand)
export class BanAdminCommandHandler implements ICommandHandler<BanAdminCommand> {
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
    ) {}

    /**
     * Executes the ban admin command.
     *
     * @param command The ban admin command parameters
     * @throws {ResourceNotFoundException} When the target admin does not exist.
     * @throws {AccessDeniedException} When attempting to ban a super administrator.
     */
    async execute(command: BanAdminCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        if (admin.role === AdminRole.SUPER_ADMIN) {
            throw new AccessDeniedException();
        }

        admin.ban();
        await this.adminWriterPort.save(admin);

        try {
            await this.sessionPort.setVersion(command.id, admin.version);
        } catch {
            // Best-effort instant eviction.
        }
    }
}
