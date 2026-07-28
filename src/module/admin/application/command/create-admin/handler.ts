/**
 * @file create-admin.handler.ts
 * @description Handles CreateAdminCommand. Creates and persists a new Admin aggregate root,
 * returning only the generated ID so the presentation layer can re-query via the read path.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { generateSecurePassword } from 'src/core/security/util';
import { CreateAdminCommand } from 'src/module/admin/application/command/create-admin/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { AdminRole } from 'src/shared/domain/admin';
import { uuidv7 } from 'uuidv7';

/**
 * Creates a new admin account with a generated secure password and returns the entity ID.
 */
@CommandHandler(CreateAdminCommand)
export class CreateAdminCommandHandler implements ICommandHandler<CreateAdminCommand> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param adminWriterPort The port used to persist the admin aggregate
     * @param hashingPort The port used to hash the generated password
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
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

        await this.adminWriterPort.save(admin);

        return admin.id;
    }
}
