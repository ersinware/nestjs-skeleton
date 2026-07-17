/**
 * @file handler.ts
 * @description Handles the DeleteAdminCommand by revoking sessions, preventing super-admin deletion, and soft-deleting the entity.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AccessDeniedException, ResourceNotFoundException } from 'src/core/exception';
import { LogPayload } from 'src/core/observability';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security';
import { DeleteAdminCommand } from 'src/module/admin/application/command/delete-admin/command';
import { TOKEN_ADMIN_WRITER_PORT, type IAdminWriterPort } from 'src/module/admin/application/command/port';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * Handler for the DeleteAdminCommand.
 * Soft-deletes an admin account while enforcing authorization rules.
 */
@CommandHandler(DeleteAdminCommand)
export class DeleteAdminCommandHandler implements ICommandHandler<DeleteAdminCommand> {
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
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

        try {
            await this.sessionPort.setVersion(command.id, admin.version);
        } catch (error) {
            this.loggerPort.error(
                new LogPayload({ class: DeleteAdminCommandHandler.name, method: this.execute.name, error }),
            );
        }
    }
}
