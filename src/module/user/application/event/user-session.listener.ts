/**
 * @file user-session.listener.ts
 * @description Event listener that reconciles Redis session/ban/watermark state with the database
 * whenever a user's access-relevant state changes, by dispatching the reconcile command.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { OnAppEvent } from 'src/core/event-bus';
import { ReconcileUserSessionCommand } from 'src/module/user/application/command/reconcile-user-session/command';
import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Keeps the Redis session version in sync with the database by dispatching the reconcile command on
 * every access-relevant user event. Kept thin: it only forwards the id; the read-and-push work and its
 * idempotency live in the command handler.
 */
@Injectable()
export class UserSessionListener {
    /**
     * Injects the command pipeline used to dispatch the reconcile command.
     *
     * @param commandPipeline The CQRS command pipeline.
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches session reconciliation on every version-bumping user event. UNBANNED is deliberately
     * absent: lifting a ban does not change the session version, so there is nothing to reconcile.
     *
     * @param event The dispatched event message carrying the user id.
     */
    @OnAppEvent(UserEvent.BANNED)
    @OnAppEvent(UserEvent.PASSWORD_CHANGED)
    @OnAppEvent(UserEvent.DELETED)
    @OnAppEvent(UserEvent.SESSIONS_REVOKED)
    async reconcile(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(new ReconcileUserSessionCommand(event.aggregateId));
    }
}
