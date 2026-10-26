/**
 * @file handler.ts
 * @description Handler for BanAdminCommand.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { BanAdminCommand } from 'src/module/admin/application/command/ban-admin/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { AdminAuditAction } from 'src/module/admin/shared/admin-audit';
import { PrincipalType } from 'src/shared/domain/principal';
import {
    ExceptionKind,
    ResourceNotFoundException,
    isExceptionOfKind,
    isExceptionWithAudit,
} from 'src/shared/exception';

/**
 * Bans the admin account and revokes all of its active sessions. The aggregate refuses an actor
 * banning themselves, root, or a manager unless the actor is root.
 */
@CommandHandler(BanAdminCommand)
export class BanAdminCommandHandler implements ICommandHandler<BanAdminCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param adminWriterPort The port used to load and persist the admin aggregate
     * @param sessionPort The port used to revoke the banned admin's sessions
     * @param auditPort The port used to record the ban
     * @param errorReporterPort The port used to report unexpected background session failures
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_ERROR_REPORTER_PORT) private readonly errorReporterPort: IErrorReporterPort,
    ) {}

    /**
     * Executes the ban.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the target admin does not exist.
     * @throws {AccessDeniedException} When the actor targets themselves or root, or a manager without being root.
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When an account or actor invariant is violated, or required jobs are not accepted
     */
    async execute(command: BanAdminCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        // On an already-banned account `ban()` is a no-op: nothing changed, so there is nothing to
        // persist, audit, or evict.
        try {
            if (!admin.ban(command.actor)) {
                return;
            }
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: admin.id }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        await this.transactionPort.run(async () => {
            await this.adminWriterPort.save(admin);
            await this.auditPort.record({ action: AdminAuditAction.ADMIN_BANNED, targetId: admin.id });
        });

        // Best-effort instant eviction, fire-and-forget: the DB version already denies the next
        // refresh, so the response does not wait on Redis.
        void this.sessionPort
            .setVersion(admin.id, PrincipalType.ADMIN, admin.sessionVersion)
            .catch((error: unknown) => {
                if (isExceptionOfKind(error, ExceptionKind.DEPENDENCY_UNAVAILABLE)) {
                    return;
                }

                this.errorReporterPort.report(error, {
                    class: this.constructor.name,
                    method: this.execute.name,
                    message: 'Best-effort session version update failed.',
                });
            });
    }
}
