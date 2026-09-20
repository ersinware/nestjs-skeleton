/**
 * @file handler.ts
 * @description Persists user session revocation, audit evidence, and follow-up jobs.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { RevokeUserSessionsCommand } from 'src/module/user/application/command/revoke-user-sessions/command';

/**
 * Coordinates durable revocation of all sessions for a user.
 */
@CommandHandler(RevokeUserSessionsCommand)
export class RevokeUserSessionsCommandHandler implements ICommandHandler<RevokeUserSessionsCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort Commit boundary for the aggregate, jobs, and audit
     * @param userWriterPort The port used to load and save the user aggregate
     * @param auditPort The port used to record the revocation
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Revokes every session for the requested user.
     *
     * @param command The command payload
     */
    async execute(command: RevokeUserSessionsCommand) {
        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            return;
        }

        user.revokeSessions(command.reason);

        await this.transactionPort.run(async () => {
            await Promise.all([
                this.userWriterPort.save(user),
                this.auditPort.record({ action: AuditAction.USER_SESSIONS_REVOKED, targetId: user.id }),
            ]);
        });
    }
}
