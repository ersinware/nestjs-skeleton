/**
 * @file handler.ts
 * @description Handles DeleteUserCommand. Performs a soft delete on the User aggregate root.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { DeleteUserCommand } from 'src/module/user/application/command/delete-user/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Marks a user account as deleted.
 */
@CommandHandler(DeleteUserCommand)
export class DeleteUserCommandHandler implements ICommandHandler<DeleteUserCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and save the user aggregate
     * @param sessionPort The port used to push the session version to Redis
     * @param auditPort The port used to record the deletion for the audit trail
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the delete user command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the user does not exist
     */
    async execute(command: DeleteUserCommand) {
        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        user.markAsDeleted();
        await this.userWriterPort.save(user);
        this.auditPort.record({ action: AuditAction.USER_DELETED });

        // Best-effort instant eviction, fire-and-forget: the DB version already denies the next
        // refresh, so the response does not wait on Redis. The catch only stops an unhandled rejection.
        this.sessionPort.setVersion(user.id, user.sessionVersion).catch(() => {});
    }
}
