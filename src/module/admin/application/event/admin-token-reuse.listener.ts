/**
 * @file admin-token-reuse.listener.ts
 * @description Listener that reacts to auth's refresh-token-reuse event by dispatching session revocation.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { OnAppEvent } from 'src/core/event-bus';
import { RevokeAdminSessionsCommand } from 'src/module/admin/application/command/revoke-admin-sessions/command';
import type { DispatchedDomainEvent } from 'src/shared/application/event';
import { AdminIntegrationEvent } from 'src/shared/domain/admin';

/**
 * Bridges auth's refresh-token-reuse integration event to the session-revocation command. Kept thin:
 * it only forwards the id; the actual work and its idempotency live in the command handler.
 */
@Injectable()
export class AdminTokenReuseListener {
    /**
     * Injects the pipeline the listener dispatches its command through.
     *
     * @param commandPipeline The CQRS command pipeline
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches session revocation when auth reports refresh-token reuse for an admin.
     *
     * @param event The event carrying the admin id
     */
    @OnAppEvent(AdminIntegrationEvent.REFRESH_REUSE_DETECTED)
    async revokeSessions(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(new RevokeAdminSessionsCommand(event.aggregateId));
    }
}
