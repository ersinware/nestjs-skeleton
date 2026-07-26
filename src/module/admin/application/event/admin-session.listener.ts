/**
 * @file admin-session.listener.ts
 * @description Event listener that pushes the admin's DB session version into Redis whenever an
 * admin's access-relevant state changes, by dispatching the reconcile command. Emitted by the writer
 * adapter after the admin row is written, so revocation only happens once the record is persisted.
 */

import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CommandPipeline } from 'src/core/cqrs';
import { ReconcileAdminSessionCommand } from 'src/module/admin/application/command/reconcile-admin-session/command';
import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Reacts to admin status changes by dispatching the reconcile command that pushes the current database
 * session version into Redis. Kept thin: it only forwards the id; the read-and-push work and its
 * idempotency live in the command handler.
 */
@Injectable()
export class AdminSessionListener {
    /**
     * Injects the command pipeline used to dispatch the reconcile command.
     *
     * @param commandPipeline The CQRS command pipeline.
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches session reconciliation on every access-relevant admin event.
     *
     * `suppressErrors: false` is load-bearing: the library default is `true`, which catches a thrown
     * error and only logs it, letting `emitAsync` resolve — a Redis outage in the handler would then
     * silently leave the revocation unapplied. With it set, the failure surfaces to the `save()` that
     * emitted the event.
     *
     * @param event The dispatched event message carrying the admin id.
     */
    @OnEvent(AdminEvent.BANNED, { suppressErrors: false })
    @OnEvent(AdminEvent.UNBANNED, { suppressErrors: false })
    @OnEvent(AdminEvent.DELETED, { suppressErrors: false })
    @OnEvent(AdminEvent.SESSION_REUSE_REVOKED, { suppressErrors: false })
    async reconcile(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(new ReconcileAdminSessionCommand(event.aggregateId));
    }
}
