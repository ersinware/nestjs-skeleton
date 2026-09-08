/**
 * @file handler.ts
 * @description Handles ChangeUserPermissionsCommand. Applies the new permission set to the User aggregate, persists it, and cuts the sessions that carried the old set.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { ChangeUserPermissionsCommand } from 'src/module/user/application/command/change-user-permissions/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { ResourceNotFoundException } from 'src/shared/exception';

/**
 * Replaces a user's permission set. The aggregate validates the set against the user catalog;
 * this handler persists the outcome and records the evidence.
 */
@CommandHandler(ChangeUserPermissionsCommand)
export class ChangeUserPermissionsCommandHandler implements ICommandHandler<ChangeUserPermissionsCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and persist the user aggregate
     * @param sessionPort The port used to push the bumped session version to Redis
     * @param auditPort The port used to record the change
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the permission change.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the target user does not exist.
     * @throws {InvalidInputException} When the set holds a permission a user may not hold.
     */
    async execute(command: ChangeUserPermissionsCommand) {
        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        // A set that already holds changes nothing: nothing to persist, audit, or evict.
        const change = user.changePermissions(command.permissions, command.actor);

        if (!change) {
            return;
        }

        await this.userWriterPort.save(user);
        await this.auditPort.record({
            action: AuditAction.USER_PERMISSIONS_CHANGED,
            targetId: user.id,
            detail: { granted: change.granted, revoked: change.revoked },
        });

        // Best-effort instant eviction, fire-and-forget: the DB version already denies the next
        // refresh, so the response does not wait on Redis. The catch only stops an unhandled rejection.
        this.sessionPort.setVersion(user.id, user.sessionVersion).catch(() => {});
    }
}
