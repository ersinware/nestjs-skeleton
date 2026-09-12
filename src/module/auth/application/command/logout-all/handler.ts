/**
 * @file handler.ts
 * @description Handles the LogoutAllCommand: closes every refresh session and has the owning module
 * revoke the outstanding access tokens.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_EVENT_PUBLISHER_PORT, type IEventPublisherPort } from 'src/core/event-bus';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
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
 * Closes every refresh session and schedules the access-token cut-off.
 */
@CommandHandler(LogoutAllCommand)
export class LogoutAllCommandHandler implements ICommandHandler<LogoutAllCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param sessionPort The port used to close every refresh session
     * @param eventPublisherPort The port used to publish the logout-all event
     * @param auditPort The port used to record the logout
     */
    constructor(
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_EVENT_PUBLISHER_PORT) private readonly eventPublisherPort: IEventPublisherPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the logout all command. The refresh sessions are auth's own and close here; the
     * session counters that kill the issued access tokens belong to the principal's aggregate, so
     * that bump is the owning module's reaction to the event. Auth never writes a guessed version
     * to Redis: the mirror would run ahead of the DB and lock the owner out until the counter caught up.
     *
     * @param command The logout all command parameters
     */
    async execute(command: LogoutAllCommand) {
        // The event and the record are one act, kept adjacent and first: they share the durable
        // write once the outbox lands, and the sweep below can fail. Awaited, unlike the reuse path:
        // a logout-all whose cut-off cannot be scheduled must not answer 204. A retry re-emits;
        // the resulting extra bump is harmless.
        await this.eventPublisherPort.emitAsync(LOGOUT_ALL_EVENT_BY_PRINCIPAL_TYPE[command.principalType], {
            aggregateId: command.id,
            eventId: uuidv7(),
        });

        // No `targetId`: `id` comes from the access token, so it is the actor the context already names.
        await this.auditPort.record({ action: AuditAction.LOGOUT_ALL });

        // A failure here 503s after the durable part is scheduled and recorded.
        await this.sessionPort.closeAllSessions(command.id);
    }
}
