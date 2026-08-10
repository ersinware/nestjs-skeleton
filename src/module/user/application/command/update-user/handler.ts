/**
 * @file handler.ts
 * @description Handles UpdateUserCommand. Applies profile changes to the User aggregate root and persists it.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { UpdateUserCommand } from 'src/module/user/application/command/update-user/command';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Updates profile fields on an existing user.
 */
@CommandHandler(UpdateUserCommand)
export class UpdateUserCommandHandler implements ICommandHandler<UpdateUserCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and save the user aggregate
     * @param auditPort The port used to record the profile change for the audit trail
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the update user command.
     * When neither email nor name is provided the command is a no-op and returns immediately.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When no active user exists with the given ID
     */
    async execute(command: UpdateUserCommand) {
        const { id, email, name } = command;

        if (!email && !name) {
            return;
        }

        const user = await this.userWriterPort.load(id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        // `updateProfile` reports whether anything actually changed. On a payload matching the
        // current state there is nothing to persist or audit — an entry for a change that changed
        // nothing would fabricate a fact.
        if (!user.updateProfile({ ...(name && { name }), ...(email && { email }) })) {
            return;
        }

        await this.userWriterPort.save(user);
        this.auditPort.record({ action: AuditAction.USER_UPDATED });
    }
}
