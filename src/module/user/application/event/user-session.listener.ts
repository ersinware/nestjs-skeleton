/**
 * @file user-session.listener.ts
 * @description Listener that reacts to version-bumping user events by dispatching session reconciliation.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { OnAppEvent } from 'src/core/event-bus';
import { ReconcileUserSessionCommand } from 'src/module/user/application/command/reconcile-user-session/command';
import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Bridges version-bumping user events to the reconcile command that pushes the current DB session
 * version into Redis. Kept thin: it only forwards the id; the read-and-push work and its idempotency
 * live in the command handler.
 */
@Injectable()
export class UserSessionListener {
    /**
     * Injects the pipeline the listener dispatches its command through.
     *
     * @param commandPipeline The CQRS command pipeline
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches session reconciliation on every version-bumping user event. UNBANNED is deliberately
     * absent: lifting a ban does not change the session version, so there is nothing to reconcile.
     *
     * @param event The event carrying the user id
     */
    @OnAppEvent(UserEvent.BANNED)
    @OnAppEvent(UserEvent.PASSWORD_CHANGED)
    @OnAppEvent(UserEvent.DELETED)
    @OnAppEvent(UserEvent.SESSIONS_REVOKED)
    @OnAppEvent(UserEvent.PERMISSIONS_CHANGED)
    async reconcile(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(new ReconcileUserSessionCommand(event.aggregateId));
    }
}
