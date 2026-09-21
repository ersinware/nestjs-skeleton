/**
 * @file handler.ts
 * @description Handles ChangeAdminPermissionsCommand. Applies the new permission set to the Admin aggregate, persists it, and cuts the sessions that carried the old set.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { ChangeAdminPermissionsCommand } from 'src/module/admin/application/command/change-admin-permissions/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { ExceptionKind, ResourceNotFoundException, isExceptionOfKind } from 'src/shared/exception';

/**
 * Replaces an admin's permission set. The aggregate decides whether the actor may (self, root, the
 * tier rules); this handler persists the outcome and records the evidence.
 */
@CommandHandler(ChangeAdminPermissionsCommand)
export class ChangeAdminPermissionsCommandHandler implements ICommandHandler<ChangeAdminPermissionsCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param adminWriterPort The port used to load and persist the admin aggregate
     * @param sessionPort The port used to push the bumped session version to Redis
     * @param auditPort The port used to record the change
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
     * Executes the permission change.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the target admin does not exist.
     * @throws {AccessDeniedException} When the actor targets themselves or root, moves a tier marker without being root, or revokes from a manager without being root.
     * @throws {InvalidInputException} When the set holds a permission an admin may not hold.
     */
    async execute(command: ChangeAdminPermissionsCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        // A set that already holds changes nothing: nothing to persist, audit, or evict.
        const change = admin.changePermissions(command.permissions, command.actor);

        if (!change) {
            return;
        }

        await this.transactionPort.run(async () => {
            await this.adminWriterPort.save(admin);
            await this.auditPort.record({
                action: AuditAction.ADMIN_PERMISSIONS_CHANGED,
                targetId: admin.id,
                detail: { granted: change.granted, revoked: change.revoked },
            });
        });

        // Best-effort instant eviction, fire-and-forget: the DB version already denies the next
        // refresh, so the response does not wait on Redis.
        void this.sessionPort.setVersion(admin.id, admin.sessionVersion).catch((error: unknown) => {
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
