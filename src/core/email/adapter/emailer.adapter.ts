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
import { SystemException } from 'src/shared/exception';

/**
 * Sends transactional email through Resend with a stable key for each outgoing request.
 */
@Injectable()
export class EmailerAdapter implements IEmailerPort {
    private readonly resend: Resend;
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
            throw new SystemException(
                `Email provider request failed: ${error.name} (${error.statusCode ?? 'unknown status'}).`,
            );
        }
    }
}
