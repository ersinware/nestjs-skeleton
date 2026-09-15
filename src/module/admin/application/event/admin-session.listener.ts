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
     * Reconciles session versions for accounts that may have sessions. INVITED is excluded because
     * pending accounts cannot log in; unbanning does not advance a version.
     *
     * @param event The event carrying the admin id
     */
    @OnAppEvent(AdminEvent.BANNED)
    @OnAppEvent(AdminEvent.PASSWORD_CHANGED)
    @OnAppEvent(AdminEvent.DELETED)
    @OnAppEvent(AdminEvent.SESSIONS_REVOKED)
    @OnAppEvent(AdminEvent.PERMISSIONS_CHANGED)
    async reconcile(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(new ReconcileAdminSessionCommand(event.aggregateId));
    }
}
