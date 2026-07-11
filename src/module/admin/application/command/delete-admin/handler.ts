/**
 * @file handler.ts
 * @description Handles the DeleteAdminCommand by revoking sessions, preventing super-admin deletion, and soft-deleting the entity.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AccessDeniedException, ResourceNotFoundException } from 'src/core/exception';
import type { ITransactionalOutboxPort } from 'src/core/outbox/port';
import { TOKEN_TRANSACTIONAL_OUTBOX_PORT } from 'src/core/outbox/port';
import { DeleteAdminCommand } from 'src/module/admin/application/command/delete-admin/command';
import { type IAdminWriterPort, TOKEN_ADMIN_WRITER_PORT } from 'src/module/admin/application/command/port';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * Handler for the DeleteAdminCommand.
 * Soft-deletes an admin account while enforcing authorization rules.
 */
@CommandHandler(DeleteAdminCommand)
export class DeleteAdminCommandHandler implements ICommandHandler<DeleteAdminCommand> {
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_TRANSACTIONAL_OUTBOX_PORT) private readonly transactionalOutboxPort: ITransactionalOutboxPort,
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
        await this.transactionalOutboxPort.run(() => this.adminWriterPort.save(admin), admin);
    }
}
