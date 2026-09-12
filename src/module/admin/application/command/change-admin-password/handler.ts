/**
 * @file handler.ts
 * @description Handles ChangeAdminPasswordCommand. Verifies the current password before changing it and revoking every session.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import {
    ChangeAdminPasswordCommand,
    ChangeAdminPasswordMessage,
} from 'src/module/admin/application/command/change-admin-password/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import {
    ExceptionKind,
    InvalidInputException,
    ResourceNotFoundException,
    SystemException,
    isExceptionOfKind,
} from 'src/shared/exception';

/**
 * Changes the password for an existing admin account.
 */
@CommandHandler(ChangeAdminPasswordCommand)
export class ChangeAdminPasswordCommandHandler implements ICommandHandler<ChangeAdminPasswordCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param adminWriterPort The port used to load and save the admin aggregate
     * @param hashingPort The port used to verify and hash passwords
     * @param sessionPort The port used to push the session version to Redis
     * @param auditPort The port used to record the password change for the audit trail
     * @param errorReporterPort The port used to report unexpected background session failures
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_ERROR_REPORTER_PORT) private readonly errorReporterPort: IErrorReporterPort,
    ) {}

    /**
     * Executes the change admin password command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the admin does not exist
     * @throws {InvalidInputException} When the current password is invalid or the new password is the same
     */
    async execute(command: ChangeAdminPasswordCommand) {
        const { id, currentPassword, newPassword } = command,
            admin = await this.adminWriterPort.load(id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        const hashedPassword = admin.password;

        // A pending account cannot authenticate, so no request can reach this handler for it; a
        // missing password is a broken code path, not a client fault.
        if (!hashedPassword) {
            throw new SystemException('A pending account cannot change its password.', {
                context: { class: ChangeAdminPasswordCommandHandler.name, method: this.execute.name, id: admin.id },
            });
        }

        if (!(await this.hashingPort.verify(hashedPassword, currentPassword))) {
            throw new InvalidInputException(ChangeAdminPasswordMessage.CURRENT_PASSWORD_MISMATCH);
        }

        if (await this.hashingPort.verify(hashedPassword, newPassword)) {
            throw new InvalidInputException(ChangeAdminPasswordMessage.PASSWORD_REUSE);
        }

        admin.changePassword(await this.hashingPort.hash(newPassword));
        await this.adminWriterPort.save(admin);
        await this.auditPort.record({ action: AuditAction.PASSWORD_CHANGED });

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
