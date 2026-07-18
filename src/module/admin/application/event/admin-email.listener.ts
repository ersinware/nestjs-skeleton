/**
 * @file admin-email.listener.ts
 * @description Event listener responsible for orchestrating email-related side effects in response to administrative lifecycle events.
 */

import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TOKEN_EMAILER_PORT, type IEmailerPort } from 'src/core/email';
import {
    TOKEN_GET_ADMIN_EMAIL_AND_NAME_PORT,
    type IGetAdminEmailAndNamePort,
} from 'src/module/admin/application/query/get-admin-email-and-name/port';
import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Intercepts events dispatched by the Admin domain and sends the emails they call for.
 */
@Injectable()
export class AdminEmailListener {
    /**
     * Injects the required application infrastructure services.
     *
     * @param emailAndNamePort Query port that reads the admin's email and name for the welcome email.
     * @param emailerPort Port that sends the email through the provider
     */
    constructor(
        @Inject(TOKEN_GET_ADMIN_EMAIL_AND_NAME_PORT)
        private readonly emailAndNamePort: IGetAdminEmailAndNamePort,
        @Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort,
    ) {}

    /**
     * Responds to the successful creation of a new administrator by dispatching a welcome email.
     *
     * `suppressErrors: false` is load-bearing: the library default is `true`, which catches a thrown
     * error and only logs it, letting `emitAsync` resolve — the welcome email would then be skipped
     * silently. With it set, the failure surfaces to the `save()` that emitted the event.
     *
     * @param event Primitive event payload with the new admin's identity and generated password
     */
    @OnEvent(AdminEvent.CREATED, { suppressErrors: false })
    async handleAdminCreatedEvent(event: DispatchedDomainEvent) {
        const admin = await this.emailAndNamePort.getAdminEmailAndName(event.aggregateId);

        // The admin was just created and is never hard-deleted, so a missing projection is not
        // expected; skip silently rather than dereference a null identity.
        if (!admin) {
            return;
        }

        await this.emailerPort.sendEmail({
            to: admin.email,
            subject: 'Welcome',
            body: 'TODO',
        });
    }
}
