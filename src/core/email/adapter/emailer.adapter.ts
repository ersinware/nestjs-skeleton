/**
 * @file emailer.adapter.ts
 * @description Gmail API adapter dispatching email via Google OAuth2.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, type gmail_v1 } from 'googleapis';
import { ENV } from 'src/core/config';
import type { EmailPayload, IEmailerPort } from 'src/core/email/port/emailer.port';

/**
 * Emailer sending through the Google Gmail API, authenticated via an OAuth2 refresh token.
 */
@Injectable()
export class EmailerAdapter implements IEmailerPort {
    private readonly gmail: gmail_v1.Gmail;

    /**
     * Builds the authenticated Gmail client once; credentials are read here so a missing
     * variable fails at boot, not on the first send.
     *
     * @param configService Source of the Google OAuth2 credentials.
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
     * Sends an HTML email via the Gmail API.
     *
     * @param data The recipient, subject, and body of the email
     */
    async sendEmail(data: EmailPayload) {
        await this.gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: this.buildRawEmail(data),
            },
        });
    }

    /**
     * Assembles the RFC 2822 raw message the Gmail API expects: headers and HTML body,
     * base64url-encoded without padding.
     *
     * @param data The recipient, subject, and body of the email
     * @returns The base64url-encoded raw message.
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
        ).toString('base64url');
    }
}
