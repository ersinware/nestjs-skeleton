/**
 * @file admin-email.listener.ts
 * @description Event listener responsible for orchestrating email-related side effects in response to administrative lifecycle events.
 */

import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AdminEvent } from '../enum/admin-event.enum';
import { AdminCreatedEvent } from '../event/admin-created.event';
import { TOKEN_EMAIL_SERVICE } from 'src/common/port/email/email.constant';
import type { IEmailService } from 'src/common/port/email/email.service.interface';

/**
 * Intercepts events dispatched by the Admin domain and triggers asynchronous email jobs.
 */
@Injectable()
export class AdminEmailListener {
    /**
     * Injects the required application infrastructure services.
     *
     * @param emailService Service responsible for queueing background email tasks
     */
    constructor(@Inject(TOKEN_EMAIL_SERVICE) private readonly emailService: IEmailService) {}

    /**
     * Responds to the successful creation of a new administrator by dispatching a welcome email.
     *
     * @param event Event payload containing the newly created admin entity and their raw generated password
     */
    @OnEvent(AdminEvent.CREATED)
    async handleAdminCreatedEvent(event: AdminCreatedEvent): Promise<void> {
        await this.emailService.queueWelcomeAdminEmail({
            email: event.admin.email,
            name: event.admin.name,
            password: event.plainTextPassword,
        });
    }
}
