/**
 * @file emailer.adapter.ts
 * @description Resend adapter for transactional email delivery.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { ENV } from 'src/core/config';
import { buildEmailIdempotencyKey } from 'src/core/email/email-idempotency-key.util';
import type { EmailDeliveryIdentity, EmailPayload, IEmailerPort } from 'src/core/email/port/emailer.port';
import { DependencyUnavailableException, DependencyUnavailableMessage, SystemException } from 'src/shared/exception';

/**
 * Sends transactional email through Resend with a stable key for each outgoing request.
 */
@Injectable()
export class EmailerAdapter implements IEmailerPort {
    /**
     * Provider client used to deliver transactional emails.
     */
    private readonly resend: Resend;

    /**
     * Configured sender address used for delivery and idempotency keys.
     */
    private readonly from: string;

    /**
     * Creates the provider client and reads required configuration at startup.
     *
     * @param configService Source of the email sender and API credential.
     */
    constructor(configService: ConfigService) {
        this.resend = new Resend(configService.getOrThrow<string>(ENV.EMAIL_API_KEY));
        this.from = configService.getOrThrow<string>(ENV.EMAIL_FROM_ADDRESS);
    }

    /**
     * Sends an HTML email with a key retained across retries of the same request.
     *
     * @param data The recipient, subject, and body of the email
     * @param delivery The owning queue and stable delivery identity
     */
    async sendEmail(data: EmailPayload, delivery: EmailDeliveryIdentity) {
        const { error } = await this.resend.emails.send(
            {
                from: this.from,
                to: data.to,
                subject: data.subject,
                html: data.body,
            },
            { idempotencyKey: buildEmailIdempotencyKey(data, delivery, this.from) },
        );

        if (error) {
            // Match the API's names as strings: its error catalog can precede SDK type updates.
            // A null status is ambiguous: the SDK also uses it for response-decoding failures.
            if (
                (error.statusCode === 409 &&
                    ['concurrent_idempotent_requests', 'resource_locked'].includes(error.name)) ||
                (error.statusCode === 429 && error.name === 'rate_limit_exceeded') ||
                (error.statusCode !== null &&
                    error.statusCode >= 500 &&
                    error.statusCode < 600 &&
                    ['application_error', 'service_unavailable', 'internal_server_error'].includes(error.name))
            ) {
                throw new DependencyUnavailableException(DependencyUnavailableMessage.DEFAULT, { cause: error });
            }

            throw new SystemException(
                `Email provider request failed: ${error.name} (${error.statusCode ?? 'unknown status'}).`,
                { cause: error, context: { class: this.constructor.name, method: this.sendEmail.name } },
            );
        }
    }
}
