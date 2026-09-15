/**
 * @file handler.ts
 * @description Requests account-wide access and refresh revocation from the owning module.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_EVENT_PUBLISHER_PORT, type IEventPublisherPort } from 'src/core/event-bus';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { LogoutAllCommand } from 'src/module/auth/application/command/logout-all/command';
import { AdminIntegrationEvent } from 'src/shared/domain/admin';
import { PrincipalType } from 'src/shared/domain/principal';
import { UserIntegrationEvent } from 'src/shared/domain/user';
import { uuidv7 } from 'uuidv7';

/**
 * The logout-all event each kind's owning module listens for. Exhaustive over {@link PrincipalType}
 * so a new kind fails compilation here instead of routing nowhere.
 */
const LOGOUT_ALL_EVENT_BY_PRINCIPAL_TYPE = {
    [PrincipalType.USER]: UserIntegrationEvent.LOGOUT_ALL_REQUESTED,
    [PrincipalType.ADMIN]: AdminIntegrationEvent.LOGOUT_ALL_REQUESTED,
} as const satisfies Record<PrincipalType, string>;

/**
 * Handler for the LogoutAllCommand.
 * Requests the version changes that invalidate outstanding access and refresh tokens.
 */
@CommandHandler(LogoutAllCommand)
export class LogoutAllCommandHandler implements ICommandHandler<LogoutAllCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param eventPublisherPort The port used to publish the logout-all event
     * @param auditPort The port used to record the logout
     */
    constructor(
        @Inject(TOKEN_EVENT_PUBLISHER_PORT) private readonly eventPublisherPort: IEventPublisherPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Requests revocation through the owner, which alone advances the DB session counters.
     * Redis session records expire by TTL; sweeping them could delete a concurrent new login.
     *
     * @param command The logout all command parameters
     */
    async execute(command: LogoutAllCommand) {
        // Await owner revocation before recording logout success.
        await this.eventPublisherPort.emitAsync(LOGOUT_ALL_EVENT_BY_PRINCIPAL_TYPE[command.principalType], {
            aggregateId: command.id,
            eventId: uuidv7(),
        });

        // No `targetId`: `id` comes from the access token, so it is the actor the context already names.
        await this.auditPort.record({ action: AuditAction.LOGOUT_ALL });
    }
}
