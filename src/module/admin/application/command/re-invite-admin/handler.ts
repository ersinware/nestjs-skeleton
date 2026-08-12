/**
 * @file handler.ts
 * @description Handles ReInviteAdminCommand. Re-emits the INVITED event so the invitation flow re-runs for a pending account.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_EVENT_PUBLISHER_PORT, type IEventPublisherPort } from 'src/core/event-bus';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import {
    ReInviteAdminCommand,
    ReInviteAdminMessage,
} from 'src/module/admin/application/command/re-invite-admin/command';
import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import { ResourceConflictException, ResourceNotFoundException } from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

/**
 * Re-issues the activation invitation for a pending admin. Mutates nothing: it validates that an
 * invitation still applies and re-emits the INVITED event, so the sending lives in one place.
 */
@CommandHandler(ReInviteAdminCommand)
export class ReInviteAdminCommandHandler implements ICommandHandler<ReInviteAdminCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param adminWriterPort The port used to read the admin's current state
     * @param eventPublisherPort The port the INVITED event is re-emitted through
     * @param auditPort The port used to record the re-invitation for the audit trail
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_EVENT_PUBLISHER_PORT) private readonly eventPublisherPort: IEventPublisherPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the re-invite admin command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When no active admin exists with the given ID
     * @throws {ResourceConflictException} When the account has already been activated or is banned
     */
    async execute(command: ReInviteAdminCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        if (admin.password !== null) {
            throw new ResourceConflictException(ReInviteAdminMessage.ALREADY_ACTIVATED);
        }

        // Not left to the send handler's silent skip: a 204 with no email would report an
        // invitation that never went out.
        if (admin.isBanned) {
            throw new ResourceConflictException(ReInviteAdminMessage.BANNED);
        }

        this.auditPort.record({ action: AuditAction.ADMIN_INVITED, targetId: admin.id });

        this.eventPublisherPort
            .emitAsync(AdminEvent.INVITED, { aggregateId: admin.id, eventId: uuidv7() })
            .catch(() => {});
    }
}
