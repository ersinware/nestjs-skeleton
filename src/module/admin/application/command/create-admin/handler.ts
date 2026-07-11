/**
 * @file create-admin.handler.ts
 * @description Handles CreateAdminCommand. Creates and persists a new Admin aggregate root,
 * returning only the generated ID so the presentation layer can re-query via the read path.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { ITransactionalOutboxPort } from 'src/core/outbox/port';
import { TOKEN_TRANSACTIONAL_OUTBOX_PORT } from 'src/core/outbox/port';
import { generateSecurePassword, TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security';
import { CreateAdminCommand } from 'src/module/admin/application/command/create-admin/command';
import { TOKEN_ADMIN_WRITER_PORT, type IAdminWriterPort } from 'src/module/admin/application/command/port';
import { Admin } from 'src/module/admin/domain/aggregate';
import { AdminRole } from 'src/shared/domain/admin';
import { uuidv7 } from 'uuidv7';

/**
 * Creates a new admin account with a generated secure password and returns the entity ID.
 */
@CommandHandler(CreateAdminCommand)
export class CreateAdminCommandHandler implements ICommandHandler<CreateAdminCommand> {
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_TRANSACTIONAL_OUTBOX_PORT) private readonly transactionalOutboxPort: ITransactionalOutboxPort,
    ) {}

    /**
     * Executes the create admin command.
     *
     * @param command The command payload
     * @returns The unique identifier of the newly created admin
     */
    async execute(command: CreateAdminCommand): Promise<string> {
        const admin = Admin.create(uuidv7(), {
            email: command.email,
            name: command.name,
            password: await this.hashingPort.hash(generateSecurePassword()),
            role: AdminRole.ADMIN,
        });

        await this.transactionalOutboxPort.run(() => this.adminWriterPort.save(admin), admin);

        return admin.id;
    }
}
