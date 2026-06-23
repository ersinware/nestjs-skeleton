/**
 * @file gmail.service.ts
 * @description Service wrapping the Google OAuth2 Gmail API email dispatch logic.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { ENV } from 'src/common/config/constant/env.constant';
import { Environment } from 'src/common/enum/config/environment.enum';

@Injectable()
export class GmailService {
    private readonly gmail;
    private readonly senderEmail: string;

    /**
     * Creates an instance of GmailService.
     *
     * @param configService Configuration client to retrieve Google OAuth2 credentials.
     */
    constructor(private readonly configService: ConfigService) {
        this.senderEmail = this.configService.getOrThrow<string>(ENV.GMAIL_USER_EMAIL);

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
     * @param to Recipient email address.
     * @param subject Email subject line.
     * @param body HTML body content.
     */
    async sendEmail(to: string, subject: string, body: string) {
        if (this.configService.getOrThrow<Environment>(ENV.NODE_ENV) === Environment.TEST) {
            // Bypass sending real emails in test/CI environments, E2E tests, and automated fuzzing (Schemathesis)
            // to prevent Google Gmail API quota exhaustion and account rate-limiting/suspension.
            return;
        }

        await this.gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: this.buildRawEmail(to, subject, body),
            },
        });
    }

    /**
     * Formats email components into a base64url-encoded RFC 2822 raw message.
     *
     * @param to Recipient email address.
     * @param subject Email subject line.
     * @param body HTML body content.
     * @returns The base64url encoded RFC 2822 message string.
     */
    private buildRawEmail(to: string, subject: string, body: string): string {
        return Buffer.from(
            [
                `From: ${this.senderEmail}`,
                `To: ${to}`,
                `Subject: ${subject}`,
                'Content-Type: text/html; charset=utf-8',
                'MIME-Version: 1.0',
                '',
                body,
            ].join('\r\n'),
        )
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }
}
