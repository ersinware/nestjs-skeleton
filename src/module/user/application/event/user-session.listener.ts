/**
 * @file user-session.listener.ts
 * @description Event listener that reconciles Redis session/ban/watermark state with the database
 * whenever a user's access-relevant state changes, by dispatching the reconcile command.
 */

import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CommandPipeline } from 'src/core/cqrs';
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
     * Dispatches session reconciliation on every access-relevant user event.
     *
     * `suppressErrors: false` is load-bearing: the library default is `true`, which catches a thrown
     * error and only logs it, letting `emitAsync` resolve — a Redis outage in the handler would then
     * silently leave the revocation unapplied. With it set, the failure surfaces to the `save()` that
     * emitted the event.
     *
     * @param event The dispatched event message carrying the user id.
     */
    @OnEvent(UserEvent.BANNED, { suppressErrors: false })
    @OnEvent(UserEvent.UNBANNED, { suppressErrors: false })
    @OnEvent(UserEvent.PASSWORD_CHANGED, { suppressErrors: false })
    @OnEvent(UserEvent.DELETED, { suppressErrors: false })
    @OnEvent(UserEvent.SESSION_REUSE_REVOKED, { suppressErrors: false })
    async reconcile(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(new ReconcileUserSessionCommand(event.aggregateId));
    }
}
