/**
 * @file admin-invite.listener.ts
 * @description Listener that reacts to the INVITED event by dispatching the invitation-email command.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { OnAppEvent } from 'src/core/event-bus';
import { SendAdminInviteCommand } from 'src/module/admin/application/command/send-admin-invite/command';
import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Bridges the INVITED event to the invitation-email command. Kept thin: it only forwards the id;
 * the work lives in the command handler.
 */
@Injectable()
export class AdminInviteListener {
    /**
     * Injects the pipeline the listener dispatches its command through.
     *
     * @param commandPipeline The CQRS command pipeline
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches the invitation email when an admin account is created or re-invited.
     *
     * @param event The event carrying the admin id
     */
    @OnAppEvent(AdminEvent.INVITED)
    async sendInvite(event: DispatchedDomainEvent) {
        await this.commandPipeline.execute(new SendAdminInviteCommand(event.aggregateId));
    }
}
