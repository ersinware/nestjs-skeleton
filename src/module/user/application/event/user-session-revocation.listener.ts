/**
 * @file user-session-revocation.listener.ts
 * @description Listener that turns auth's session-revocation events into RevokeUserSessionsCommand.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { OnAppEvent } from 'src/core/event-bus';
import { RevokeUserSessionsCommand } from 'src/module/user/application/command/revoke-user-sessions/command';
import type { DispatchedDomainEvent } from 'src/shared/application/event';
import { SessionRevocationReason } from 'src/shared/domain/principal';
import { UserIntegrationEvent } from 'src/shared/domain/user';

/**
 * Bridges auth's integration events to the revocation command. Which event arrived is the
 * command's reason; the work and its idempotency live in the handler.
 */
@Injectable()
export class UserSessionRevocationListener {
    /**
     * Injects the pipeline the listener dispatches its command through.
     *
     * @param commandPipeline The CQRS command pipeline
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches revocation when auth detected refresh-token reuse for a user.
     *
     * @param event The event carrying the user id
     */
    @OnAppEvent(UserIntegrationEvent.REFRESH_REUSE_DETECTED)
    async revokeAfterReuse(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(
            new RevokeUserSessionsCommand(event.aggregateId, SessionRevocationReason.REFRESH_REUSE),
        );
    }

    /**
     * Dispatches revocation when a user asked to be signed out of every device.
     *
     * @param event The event carrying the user id
     */
    @OnAppEvent(UserIntegrationEvent.LOGOUT_ALL_REQUESTED)
    async revokeAfterLogoutAll(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(
            new RevokeUserSessionsCommand(event.aggregateId, SessionRevocationReason.LOGOUT_ALL),
        );
    }
}
