/**
 * @file handler.ts
 * @description Requests account-wide access and refresh revocation from the owning module.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_OUTBOX_WRITER_PORT, type IOutboxWriterPort } from 'src/core/outbox';
import { LogoutAllCommand } from 'src/module/auth/application/command/logout-all/command';
import { AdminIntegrationEvent } from 'src/shared/domain/admin';
import { PrincipalType } from 'src/shared/domain/principal';
import { UserIntegrationEvent } from 'src/shared/domain/user';

/**
 * The logout-all event each kind's owning module listens for. Exhaustive over {@link PrincipalType}
 * so a new kind fails compilation here instead of routing nowhere.
 */
const LOGOUT_ALL_EVENT_BY_PRINCIPAL_TYPE = {
    [PrincipalType.USER]: UserIntegrationEvent.LOGOUT_ALL_REQUESTED,
    [PrincipalType.ADMIN]: AdminIntegrationEvent.LOGOUT_ALL_REQUESTED,
} as const satisfies Record<PrincipalType, string>;

/**
 * Handler for the LogoutAllCommand.
 * Requests the version changes that invalidate outstanding access and refresh tokens.
 */
@CommandHandler(LogoutAllCommand)
export class LogoutAllCommandHandler implements ICommandHandler<LogoutAllCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param outboxWriterPort The port used to persist the logout-all event
     * @param transactionPort Commits the event and audit together
     * @param auditPort The port used to record the logout
     */
    constructor(
        @Inject(TOKEN_OUTBOX_WRITER_PORT) private readonly outboxWriterPort: IOutboxWriterPort,
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Requests revocation through the owner, which alone advances the DB session counters.
     * Redis session records expire by TTL; sweeping them could delete a concurrent new login.
     *
     * @param command The logout all command parameters
     */
    async execute(command: LogoutAllCommand) {
        await this.transactionPort.run(async () => {
            await Promise.all([
                this.outboxWriterPort.save({
                    eventType: LOGOUT_ALL_EVENT_BY_PRINCIPAL_TYPE[command.principalType],
                    aggregateId: command.id,
                }),
                // The verified principal already identifies the actor in the audit context.
                this.auditPort.record({ action: AuditAction.LOGOUT_ALL }),
            ]);
        });
    }
}
