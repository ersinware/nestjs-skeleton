/**
 * @file admin-email.listener.ts
 * @description Event listener that reacts to administrative lifecycle events by dispatching the
 * commands for their email side effects.
 */

import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CommandPipeline } from 'src/core/cqrs';
import { SendAdminWelcomeEmailCommand } from 'src/module/admin/application/command/send-admin-welcome-email/command';
import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Bridges Admin domain lifecycle events to the commands that send the emails they call for. Kept thin:
 * it only forwards the id; reading the recipient and sending live in the command handler.
 */
@Injectable()
export class AdminEmailListener {
    /**
     * Injects the command pipeline used to dispatch the email commands.
     *
     * @param commandPipeline The CQRS command pipeline.
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches the welcome email when a new administrator is created.
     *
     * `suppressErrors: false` is load-bearing: the library default is `true`, which catches a thrown
     * error and only logs it, letting `emitAsync` resolve — the welcome email would then be skipped
     * silently. With it set, the failure surfaces to the `save()` that emitted the event.
     *
     * @param event Dispatched event carrying the new admin's id.
     */
    @OnEvent(AdminEvent.CREATED, { suppressErrors: false })
    async handleAdminCreatedEvent(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(new SendAdminWelcomeEmailCommand(event.aggregateId));
    }
}
