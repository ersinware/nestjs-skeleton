/**
 * @file emailer.adapter.ts
 * @description Service wrapping the Google OAuth2 Gmail API email dispatch logic.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { ENV, Environment } from 'src/core/config';
import type { EmailPayload } from 'src/core/email/email-payload.type';
import type { IEmailerPort } from 'src/core/email/port/emailer.port';

/**
 * Service wrapper for interacting with the Google Gmail API using OAuth2 authentication.
 */
@Injectable()
export class EmailerAdapter implements IEmailerPort {
    private readonly gmail;

    /**
     * Creates an instance of EmailerAdapter.
     *
     * @param configService Configuration client to retrieve Google OAuth2 credentials.
     */
    constructor(private readonly configService: ConfigService) {
        const oauth2Client = new google.auth.OAuth2(
            this.configService.getOrThrow<string>(ENV.GMAIL_CLIENT_ID),
            this.configService.getOrThrow<string>(ENV.GMAIL_CLIENT_SECRET),
        );

        oauth2Client.setCredentials({ refresh_token: this.configService.getOrThrow<string>(ENV.GMAIL_REFRESH_TOKEN) });
        this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    }

    /**
     * Sends an HTML email via the Google Gmail API.
     *
     * @param data The email job data containing recipient, subject, and body
     */
    async sendEmail(data: EmailPayload) {
        if (this.configService.getOrThrow<Environment>(ENV.NODE_ENV) === Environment.TEST) {
            // Bypass sending real emails in test/CI environments, E2E tests, and automated fuzzing (Schemathesis)
            // to prevent Google Gmail API quota exhaustion and account rate-limiting/suspension.
            return;
        }

        await this.gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: this.buildRawEmail(data),
            },
        });
    }

    /**
     * Formats email components into a base64url-encoded RFC 2822 raw message.
     *
     * @param data The email job data containing recipient, subject, and body
     * @returns The base64url encoded RFC 2822 message string.
     */
    private buildRawEmail(data: EmailPayload): string {
        return Buffer.from(
            [
                `From: ${this.configService.getOrThrow<string>(ENV.GMAIL_USER_EMAIL)}`,
                `To: ${data.to}`,
                `Subject: ${data.subject}`,
                'Content-Type: text/html; charset=utf-8',
                'MIME-Version: 1.0',
                '',
                data.body,
            ].join('\r\n'),
        )
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }
}
