/**
 * @file handler.ts
 * @description Handles the UpdateAdminStatusCommand by updating the active status of the entity, preventing changes to super-admins.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AccessDeniedException, ResourceNotFoundException } from 'src/core/exception';
import type { ITransactionalOutboxPort } from 'src/core/outbox/port';
import { TOKEN_TRANSACTIONAL_OUTBOX_PORT } from 'src/core/outbox/port';
import { type IAdminWriterPort, TOKEN_ADMIN_WRITER_PORT } from 'src/module/admin/application/command/port';
import { UpdateAdminStatusCommand } from 'src/module/admin/application/command/update-admin-status/command';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * Handler for the UpdateAdminStatusCommand.
 * Modifies the boolean active status while enforcing authorization rules.
 */
@CommandHandler(UpdateAdminStatusCommand)
export class UpdateAdminStatusCommandHandler implements ICommandHandler<UpdateAdminStatusCommand> {
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_TRANSACTIONAL_OUTBOX_PORT) private readonly transactionalOutboxPort: ITransactionalOutboxPort,
    ) {}

    /**
     * Executes the update admin status command.
     *
     * @param command The update admin status command parameters
     * @throws {ResourceNotFoundException} When the target admin does not exist.
     * @throws {AccessDeniedException} When attempting to change the status of a super administrator.
     */
    async execute(command: UpdateAdminStatusCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        if (admin.role === AdminRole.SUPER_ADMIN) {
            throw new AccessDeniedException();
        }

        admin.updateStatus(command.active);
        await this.transactionalOutboxPort.run(() => this.adminWriterPort.save(admin), admin);
    }
}
