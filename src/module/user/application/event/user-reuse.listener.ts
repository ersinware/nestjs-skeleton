/**
 * @file user-reuse.listener.ts
 * @description In-process listener that reacts to auth's refresh-token-reuse integration event by
 * dispatching the command that revokes the user's sessions and warns the account owner.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { OnAppEvent } from 'src/core/event-bus';
import { RevokeUserSessionsCommand } from 'src/module/user/application/command/revoke-user-sessions/command';
import type { DispatchedDomainEvent } from 'src/shared/application/event';
import { UserIntegrationEvent } from 'src/shared/domain/user';

/**
 * Bridges auth's `user.refresh_reuse_detected` integration event to the user module's session-revocation
 * command. Kept thin: it only forwards the ids; idempotency and the actual work live in the command handler.
 */
@Injectable()
export class UserReuseListener {
    /**
     * Injects the command pipeline used to dispatch the revocation command.
     *
     * @param commandPipeline The CQRS command pipeline.
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches session revocation when auth reports refresh-token reuse for a user.
     *
     * @param event The dispatched integration event carrying the user id.
     */
    @OnAppEvent(UserIntegrationEvent.REFRESH_REUSE_DETECTED)
    async handleRefreshReuseDetected(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(new RevokeUserSessionsCommand(event.aggregateId));
    }
}
