/**
 * @file admin-reuse.listener.ts
 * @description In-process listener that reacts to auth's refresh-token-reuse integration event by
 * dispatching the command that revokes the admin's sessions and warns the account owner.
 */

import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { OnEvent } from '@nestjs/event-emitter';
import { RevokeAdminSessionsCommand } from 'src/module/admin/application/command/revoke-admin-sessions';
import type { DispatchedDomainEvent } from 'src/shared/application/event';
import { AdminIntegrationEvent } from 'src/shared/domain/admin';

/**
 * Bridges auth's `admin.refresh_reuse_detected` integration event to the admin module's session-revocation
 * command. Kept thin: it only forwards the ids; idempotency and the actual work live in the command handler.
 */
@Injectable()
export class AdminReuseListener {
    /**
     * Injects the command bus used to dispatch the revocation command.
     *
     * @param commandBus The CQRS command bus.
     */
    constructor(private readonly commandBus: CommandBus) {}

    /**
     * Dispatches session revocation when auth reports refresh-token reuse for an admin. The unique event
     * id is forwarded as the email idempotency key so an at-least-once redelivery yields a single email.
     *
     * `suppressErrors: false` is load-bearing: the library default is `true`, which catches a thrown
     * error and only logs it, letting `emitAsync` resolve — the revocation would then be skipped
     * silently. With it set, the failure surfaces to the emitting caller.
     *
     * @param event The dispatched integration event carrying the admin id and the unique event id.
     */
    @OnEvent(AdminIntegrationEvent.REFRESH_REUSE_DETECTED, { suppressErrors: false })
    async handleRefreshReuseDetected(event: DispatchedDomainEvent) {
        await this.commandBus.execute(new RevokeAdminSessionsCommand(event.aggregateId, event.eventId));
    }
}
