/**
 * @file admin-email.listener.ts
 * @description Event listener responsible for orchestrating email-related side effects in response to administrative lifecycle events.
 */

import { Inject, Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { OnEvent } from '@nestjs/event-emitter';
import { TOKEN_EMAIL_QUEUE_PORT, type IEmailQueuePort } from 'src/core/email/port';
import {
    GetAdminEmailAndNameQuery,
    type GetAdminEmailAndNameResult,
} from 'src/module/admin/application/query/get-admin-email-and-name';
import { AdminEvent, type AdminCreatedEvent } from 'src/module/admin/domain/event';

/**
 * Intercepts events dispatched by the Admin domain and triggers asynchronous email jobs.
 */
@Injectable()
export class AdminEmailListener {
    /**
     * Injects the required application infrastructure services.
     *
     * @param emailPort Service responsible for queueing background email tasks
     */
    constructor(
        private readonly queryBus: QueryBus,
        @Inject(TOKEN_EMAIL_QUEUE_PORT) private readonly emailQueuePort: IEmailQueuePort,
    ) {}

    /**
     * Responds to the successful creation of a new administrator by dispatching a welcome email.
     *
     * @param event Primitive event payload with the new admin's identity and generated password
     */
    @OnEvent(AdminEvent.CREATED)
    async handleAdminCreatedEvent(event: AdminCreatedEvent) {
        const admin = await this.queryBus.execute<GetAdminEmailAndNameQuery, GetAdminEmailAndNameResult>(
            new GetAdminEmailAndNameQuery(event.id),
        );

        await this.emailQueuePort.queueEmail(
            {
                to: admin.email,
                subject: 'Welcome',
                body: 'TODO',
            },
            `admin-welcome-email-${event.id}`,
        );
    }
}
