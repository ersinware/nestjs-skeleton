/**
 * @file handler.ts
 * @description Reproduces a pending user's activation JWT and emails the activation link.
 */

import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ENV } from 'src/core/config';
import {
    EMAIL_DELIVERY_PAYLOAD_CONFLICT_MESSAGE,
    TOKEN_EMAILER_PORT,
    escapeHtml,
    type EmailPayload,
    type IEmailerPort,
} from 'src/core/email';
import type { ITokenPort } from 'src/core/security/token';
import { SendUserActivationCommand } from 'src/module/user/application/command/send-user-activation/command';
import {
    TOKEN_GET_USER_ACTIVATION_RECIPIENT_PORT,
    type IGetUserActivationRecipientPort,
} from 'src/module/user/application/query/get-user-activation-recipient/port';
import {
    TOKEN_USER_ACTIVATION_TOKEN_PORT,
    USER_ACTIVATION_TOKEN_TYPE,
    type ActivationTokenPayload,
} from 'src/module/user/application/user-activation-token';
import { ExceptionKind, TerminalJobException, isExceptionOfKind } from 'src/shared/exception';

/**
 * Sends activation email only while the persisted request remains eligible. Activation must recheck
 * account state because it can change after this primary read and before email delivery.
 */
@CommandHandler(SendUserActivationCommand)
export class SendUserActivationCommandHandler implements ICommandHandler<SendUserActivationCommand, void> {
    /**
     * Initializes delivery dependencies.
     *
     * @param activationRecipientPort Reads eligible activation metadata from the primary
     * @param activationTokenPort Signs the persisted activation claims
     * @param emailerPort Sends the activation email
     * @param configService Provides the trusted frontend activation URL
     */
    constructor(
        @Inject(TOKEN_GET_USER_ACTIVATION_RECIPIENT_PORT)
        private readonly activationRecipientPort: IGetUserActivationRecipientPort,
        @Inject(TOKEN_USER_ACTIVATION_TOKEN_PORT)
        private readonly activationTokenPort: ITokenPort<typeof USER_ACTIVATION_TOKEN_TYPE>,
        @Inject(TOKEN_EMAILER_PORT) private readonly emailerPort: IEmailerPort,
        private readonly configService: ConfigService,
    ) {}

    /**
     * Sends only the request identified by this delivery job.
     *
     * @param command The account and original request identifiers
     */
    async execute(command: SendUserActivationCommand) {
        const recipient = await this.activationRecipientPort.getActivationRecipient(command.id, command.deliveryId);

        if (!recipient) {
            return;
        }

        try {
            await this.emailerPort.sendEmail(
                this.buildActivationEmail(
                    recipient.email,
                    recipient.name,
                    await this.activationTokenPort.sign<ActivationTokenPayload>(USER_ACTIVATION_TOKEN_TYPE, {
                        sub: command.id,
                        jti: recipient.activationId,
                        exp: Math.floor(recipient.activationExpiresAt.getTime() / 1000),
                        activationRevocationVersion: recipient.activationRevocationVersion,
                    }),
                    recipient.activationExpiresAt,
                ),
                { queueName: command.queueName, deliveryId: command.deliveryId },
            );
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.RESOURCE_CONFLICT)) {
                throw new TerminalJobException(EMAIL_DELIVERY_PAYLOAD_CONFLICT_MESSAGE, { cause: error });
            }

            throw error;
        }
    }

    /**
     * Encodes the token as a URL parameter before escaping the link for HTML.
     *
     * @param to The account's current email address
     * @param name Display name used in the greeting
     * @param token JWT reproduced from fixed activation metadata
     * @param expiresAt Fixed deadline set when the activation was requested
     * @returns Activation email with the trusted frontend link and actual deadline
     */
    private buildActivationEmail(to: string, name: string, token: string, expiresAt: Date): EmailPayload {
        const url = new URL(this.configService.getOrThrow<string>(ENV.USER_ACTIVATION_URL));
        url.searchParams.set('token', token);

        return {
            to,
            subject: 'Activate your account',
            body:
                `<p>Hi ${escapeHtml(name)},</p>` +
                `<p>To activate your account, open the link below and enter the password you chose when registering:</p>` +
                `<p><a href="${escapeHtml(url.toString())}">Activate your account</a></p>` +
                `<p>This link expires on ${escapeHtml(expiresAt.toUTCString())}. ` +
                `If you did not register this account, you can safely ignore this email.</p>`,
        };
    }
}
