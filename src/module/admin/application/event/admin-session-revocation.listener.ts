/**
 * @file admin-session-revocation.listener.ts
 * @description Listener that turns auth's session-revocation events into RevokeAdminSessionsCommand.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { OnAppEvent } from 'src/core/event-bus';
import { RevokeAdminSessionsCommand } from 'src/module/admin/application/command/revoke-admin-sessions/command';
import type { DispatchedDomainEvent } from 'src/shared/application/event';
import { AdminIntegrationEvent } from 'src/shared/domain/admin';
import { SessionRevocationReason } from 'src/shared/domain/principal';

/**
 * Bridges auth's integration events to the revocation command. Which event arrived is the
 * command's reason; the work and its idempotency live in the handler.
 */
@Injectable()
export class AdminSessionRevocationListener {
    /**
     * Injects the pipeline the listener dispatches its command through.
     *
     * @param commandPipeline The CQRS command pipeline
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches revocation when auth detected refresh-token reuse for an admin.
     *
     * @param event The event carrying the admin id
     */
    @OnAppEvent(AdminIntegrationEvent.REFRESH_REUSE_DETECTED)
    async revokeAfterReuse(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(
            new RevokeAdminSessionsCommand(event.aggregateId, SessionRevocationReason.REFRESH_REUSE),
        );
    }

    /**
     * Dispatches revocation when an admin asked to be signed out of every device.
     *
     * @param event The event carrying the admin id
     */
    @OnAppEvent(AdminIntegrationEvent.LOGOUT_ALL_REQUESTED)
    async revokeAfterLogoutAll(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(
            new RevokeAdminSessionsCommand(event.aggregateId, SessionRevocationReason.LOGOUT_ALL),
        );
    }
}
