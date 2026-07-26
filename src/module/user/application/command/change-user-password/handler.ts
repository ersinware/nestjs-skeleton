/**
 * @file handler.ts
 * @description Handles ChangeUserPasswordCommand. Verifies the current password and securely updates the User aggregate root.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import {
    ChangeUserPasswordCommand,
    ChangeUserPasswordMessage,
} from 'src/module/user/application/command/change-user-password/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { InvalidInputException, ResourceNotFoundException } from 'src/shared/exception';

/**
 * Changes the password for an existing user account.
 */
@CommandHandler(ChangeUserPasswordCommand)
export class ChangeUserPasswordCommandHandler implements ICommandHandler<ChangeUserPasswordCommand> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and save the user aggregate
     * @param hashingPort The port used to verify and hash passwords
     * @param sessionPort The port used to push the session version to Redis
     * @param auditPort The port used to record the password change for the audit trail
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the change user password command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the user does not exist
     * @throws {InvalidInputException} When the current password is invalid or the new password is the same
     */
    async execute(command: ChangeUserPasswordCommand) {
        const { id, currentPassword, newPassword } = command,
            user = await this.userWriterPort.load(id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        const hashedPassword = user.password;

        if (!(await this.hashingPort.verify(hashedPassword, currentPassword))) {
            throw new InvalidInputException(ChangeUserPasswordMessage.CURRENT_PASSWORD_MISMATCH);
        }

        if (await this.hashingPort.verify(hashedPassword, newPassword)) {
            throw new InvalidInputException(ChangeUserPasswordMessage.PASSWORD_REUSE);
        }

        user.changePassword(await this.hashingPort.hash(newPassword));
        await this.userWriterPort.save(user);

        // The two rejections above leave no record: a wrong current password is a failed credential
        // check on an already-authenticated session, not a privileged action, and auditing every
        // mistyped password would bury the changes that did happen.
        // No `targetId`: this command is reachable only from the self-scoped route, so the subject is
        // the actor the ambient context already names. Restating it would not add a fact, it would
        // make the same principal appear twice under two meanings.
        this.auditPort.record({ action: AuditAction.PASSWORD_CHANGED });

        // A password change bumps the session version for a permanent cut-off of every token minted
        // before it.
        try {
            await this.sessionPort.setVersion(id, user.version);
        } catch {
            // Best-effort instant eviction.
        }
    }
}
