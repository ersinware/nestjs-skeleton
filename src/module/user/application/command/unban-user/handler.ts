/**
 * @file handler.ts
 * @description Handles UnbanUserCommand. Lifts the ban on the User aggregate root and persists it.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { UnbanUserCommand } from 'src/module/user/application/command/unban-user/command';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Lifts the ban on an existing user. Unlike banning, no session eviction is needed: the version is
 * monotonic and a fresh login mints a token at the current version.
 */
@CommandHandler(UnbanUserCommand)
export class UnbanUserCommandHandler implements ICommandHandler<UnbanUserCommand> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and save the user aggregate
     * @param auditPort The port used to record the lifted ban for the audit trail
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the unban user command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the user does not exist
     */
    async execute(command: UnbanUserCommand) {
        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        // `unban()` is a silent no-op on an account that is not banned and reports whether it actually
        // transitioned. On a no-op there is nothing to persist or audit — saving would rewrite
        // identical values, and an entry for a ban that was never in place would be a fabricated fact.
        if (!user.unban()) {
            return;
        }

        await this.userWriterPort.save(user);
        this.auditPort.record({ action: AuditAction.USER_UNBANNED, targetId: command.id });
    }
}
