/**
 * @file handler.ts
 * @description Handles a public request to resend pending user activation proof.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { ResendUserActivationCommand } from 'src/module/user/application/command/resend-user-activation/command';
import { UserAuditAction } from 'src/module/user/shared/user-audit';
import { ExceptionKind, isExceptionOfKind, isExceptionWithAudit } from 'src/shared/exception';

/**
 * Persists an eligible activation request, its delivery job, and audit together.
 */
@CommandHandler(ResendUserActivationCommand)
export class ResendUserActivationCommandHandler implements ICommandHandler<ResendUserActivationCommand, void> {
    /**
     * Initializes the handler with persistence and audit dependencies.
     *
     * @param transactionPort Commits state, delivery, and audit together
     * @param userWriterPort Loads and persists the authoritative account
     * @param auditPort Records accepted requests and banned-account refusals
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Requests another email for an eligible pending account. Missing or ineligible accounts
     * return normally so the public 204 response cannot reveal account existence or status;
     * concurrent writes and infrastructure failures still propagate.
     *
     * @param command The email address to look up
     * @throws {ResourceConflictException} When the account changed concurrently
     * @throws {DependencyUnavailableException} When database, queue, or audit persistence is unavailable
     * @throws {SystemException} When account metadata is incomplete or required jobs are not accepted
     */
    async execute(command: ResendUserActivationCommand) {
        const user = await this.userWriterPort.loadByEmail(command.email);

        if (!user) {
            return;
        }

        let requested: boolean;

        try {
            requested = user.resendActivation();
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: user.id }, { markExceptionAsAudited: error });
            }

            // Preserve the public anti-enumeration response after recording the banned-account refusal.
            if (isExceptionOfKind(error, ExceptionKind.ACCESS_DENIED)) {
                return;
            }

            throw error;
        }

        if (!requested) {
            return;
        }

        await this.transactionPort.start(async () => {
            await this.userWriterPort.save(user);
            await this.auditPort.record({
                action: UserAuditAction.USER_ACTIVATION_REQUESTED,
                targetId: user.id,
                detail: { deliveryId: user.activationId! },
            });
        });
    }
}
