/**
 * @file admin-session.listener.ts
 * @description Listener that reacts to version-bumping admin events by dispatching session reconciliation.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { OnAppEvent } from 'src/core/event-bus';
import { ReconcileAdminSessionCommand } from 'src/module/admin/application/command/reconcile-admin-session/command';
import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Bridges version-bumping admin events to the reconcile command that pushes the current DB session
 * version into Redis. Kept thin: it only forwards the id; the read-and-push work and its idempotency
 * live in the command handler.
 */
@Injectable()
export class AdminSessionListener {
    /**
     * Injects the pipeline the listener dispatches its command through.
     *
     * @param commandPipeline The CQRS command pipeline
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches session reconciliation on every version-bumping admin event. UNBANNED is deliberately
     * absent: lifting a ban does not change the session version, so there is nothing to reconcile.
     *
     * @param event The event carrying the admin id
     */
    @OnAppEvent(AdminEvent.BANNED)
    @OnAppEvent(AdminEvent.DELETED)
    @OnAppEvent(AdminEvent.SESSIONS_REVOKED)
    async reconcile(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(new ReconcileAdminSessionCommand(event.aggregateId));
    }
}
