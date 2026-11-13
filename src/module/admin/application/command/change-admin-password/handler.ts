/**
 * @file handler.ts
 * @description Handles ChangeAdminPasswordCommand. Verifies the current password before changing it and revoking every session.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_IDEMPOTENCY_PORT, type IIdempotencyPort } from 'src/core/idempotency';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { ChangeAdminPasswordCommand } from 'src/module/admin/application/command/change-admin-password/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { PrincipalAuditAction } from 'src/shared/domain/principal';
import { ResourceNotFoundException, isExceptionWithAudit } from 'src/shared/exception';

/**
 * Changes the password for an existing admin account.
 */
@CommandHandler(ChangeAdminPasswordCommand)
export class ChangeAdminPasswordCommandHandler implements ICommandHandler<ChangeAdminPasswordCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param idempotencyPort The commit boundary for the business write and audit
     * @param adminWriterPort The port used to load and save the admin aggregate
     * @param hashingPort The port used to verify and hash passwords
     * @param auditPort The port used to record the password change for the audit trail
     */
    constructor(
        @Inject(TOKEN_IDEMPOTENCY_PORT) private readonly idempotencyPort: IIdempotencyPort,
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the change admin password command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the admin does not exist
     * @throws {AccessDeniedException} When the loaded account is banned
     * @throws {InvalidInputException} When the current password is invalid or the new password is the same
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When the key belongs to a different request or persistence rejects a conflicting mutation.
     * @throws {SystemException} When the loaded account violates the mutation contract or required jobs are not accepted
     */
    async execute(command: ChangeAdminPasswordCommand) {
        await this.idempotencyPort.executePrepared(
            command.idempotencyRequest,
            async () => {
                const { newPassword } = command,
                    admin = await this.adminWriterPort.load(command.id);

                if (!admin) {
                    throw new ResourceNotFoundException();
                }

                const hashedPassword = admin.password;

                return {
                    admin,
                    hashedNewPassword: await this.hashingPort.hashPassword(newPassword),
                    currentPasswordMatches: await this.hashingPort.verifyPassword(
                        hashedPassword,
                        command.currentPassword,
                    ),
                    newPasswordMatches: await this.hashingPort.verifyPassword(hashedPassword, newPassword),
                };
            },
            async ({ admin, hashedNewPassword, currentPasswordMatches, newPasswordMatches }) => {
                try {
                    admin.changePassword(hashedNewPassword, currentPasswordMatches, newPasswordMatches);
                } catch (error) {
                    if (isExceptionWithAudit(error)) {
                        await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
                    }

                    throw error;
                }

                await this.adminWriterPort.save(admin);
                await this.auditPort.record({ action: PrincipalAuditAction.PASSWORD_CHANGED });

                return { replayResultId: null };
            },
        );
    }
}
