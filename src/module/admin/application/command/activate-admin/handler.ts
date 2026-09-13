/**
 * @file handler.ts
 * @description Handles ActivateAdminCommand. Verifies the invite token against the account's live state and sets the first password.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import {
    ActivateAdminCommand,
    ActivateAdminMessage,
    ActivateAdminRejectionReason,
} from 'src/module/admin/application/command/activate-admin/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { ExceptionKind, InvalidInputException, isExceptionOfKind } from 'src/shared/exception';

/**
 * Activates a pending admin account. Verification is two-layered: the token's signature and expiry,
 * then the account's live state and revocation version. Activation consumes all invitations by
 * setting the first password.
 */
@CommandHandler(ActivateAdminCommand)
export class ActivateAdminCommandHandler implements ICommandHandler<ActivateAdminCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param adminWriterPort The port used to load and save the admin aggregate
     * @param tokenPort The port used to verify the invite token
     * @param hashingPort The port used to hash the initial password
     * @param auditPort The port used to record the activation, or its rejection, for the audit trail
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the activate admin command.
     *
     * @param command The command payload
     * @throws {InvalidInputException} When the invitation is invalid, expired, or no longer applies —
     * one message for every cause, so the endpoint discloses nothing about account state
     */
    async execute(command: ActivateAdminCommand) {
        let payload;

        try {
            payload = await this.tokenPort.verifyInviteToken(command.token);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                // The port error names the cause; the response deliberately does not.
                throw await this.deny(ActivateAdminRejectionReason.INVALID_TOKEN);
            }

            throw error;
        }

        const admin = await this.adminWriterPort.load(payload.sub);

        if (!admin) {
            throw await this.deny(ActivateAdminRejectionReason.ACCOUNT_NOT_FOUND, payload.sub);
        }

        if (admin.isBanned) {
            throw await this.deny(ActivateAdminRejectionReason.ACCOUNT_BANNED, admin.id);
        }

        if (admin.password !== null) {
            throw await this.deny(ActivateAdminRejectionReason.ACCOUNT_ALREADY_ACTIVE, admin.id);
        }

        if (payload.revocationVersion !== admin.revocationVersion) {
            throw await this.deny(ActivateAdminRejectionReason.INVITE_REVOKED, admin.id);
        }

        admin.activate(await this.hashingPort.hash(command.password));
        await this.adminWriterPort.save(admin);
        await this.auditPort.record({ action: AuditAction.ADMIN_ACTIVATED, targetId: admin.id });
    }

    /**
     * Records the rejection and builds the uniform exception. A rejected invite is the same
     * guessing signal as a failed login: only this handler knows the cause, and it names it to the
     * auditor alone.
     *
     * @param reason Why the attempt was rejected
     * @param targetId The account the token named, absent when the token could not be read
     * @returns The exception the caller throws
     */
    private async deny(reason: ActivateAdminRejectionReason, targetId?: string): Promise<InvalidInputException> {
        await this.auditPort.record({
            action: AuditAction.ADMIN_ACTIVATION_FAILED,
            reason,
            ...(targetId && { targetId }),
        });

        return new InvalidInputException(ActivateAdminMessage.INVALID_INVITE);
    }
}
