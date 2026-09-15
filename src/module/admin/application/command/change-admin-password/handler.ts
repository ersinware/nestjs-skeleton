/**
 * @file handler.ts
 * @description Handles ChangeAdminPasswordCommand. Verifies the current password before changing it and revoking every session.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import {
    ChangeAdminPasswordCommand,
    ChangeAdminPasswordMessage,
    type ChangeAdminPasswordResult,
} from 'src/module/admin/application/command/change-admin-password/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { PrincipalType } from 'src/shared/domain/principal';
import {
    AccessDeniedException,
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
export class ChangeAdminPasswordCommandHandler implements ICommandHandler<
    ChangeAdminPasswordCommand,
    ChangeAdminPasswordResult
> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param adminWriterPort The port used to load and save the admin aggregate
     * @param hashingPort The port used to verify and hash passwords
     * @param sessionPort The port used to synchronize the version and open a fresh session
     * @param auditPort The port used to record the password change for the audit trail
     * @param tokenPort The port used to sign the replacement token pair
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
    ) {}

    /**
     * Executes the change admin password command.
     * Checks the loaded account's ban state before password verification because the guard's
     * Redis version may lag behind a committed ban. Issuing tokens at the newly advanced version
     * would otherwise give that banned account access that later reconciliation would not revoke.
     *
     * @param command The command payload
     * @returns The committed password change and its session outcome
     * @throws {ResourceNotFoundException} When the admin does not exist
     * @throws {AccessDeniedException} When the loaded account is banned
     * @throws {InvalidInputException} When the current password is invalid or the new password is the same
     */
    async execute(command: ChangeAdminPasswordCommand): Promise<ChangeAdminPasswordResult> {
        const { id, newPassword } = command,
            admin = await this.adminWriterPort.load(id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        if (admin.isBanned) {
            throw new AccessDeniedException();
        }

        const hashedPassword = admin.password;

        // A pending account cannot authenticate, so no request can reach this handler for it; a
        // missing password is a broken code path, not a client fault.
        if (!hashedPassword) {
            throw new SystemException('A pending account cannot change its password.', {
                context: { class: ChangeAdminPasswordCommandHandler.name, method: this.execute.name, id: admin.id },
            });
        }

        if (!(await this.hashingPort.verify(hashedPassword, command.currentPassword))) {
            throw new InvalidInputException(ChangeAdminPasswordMessage.CURRENT_PASSWORD_MISMATCH);
        }

        if (await this.hashingPort.verify(hashedPassword, newPassword)) {
            throw new InvalidInputException(ChangeAdminPasswordMessage.PASSWORD_REUSE);
        }

        admin.changePassword(await this.hashingPort.hash(newPassword));
        await this.transactionPort.run(async () => {
            await Promise.all([
                this.adminWriterPort.save(admin),
                this.auditPort.record({ action: AuditAction.PASSWORD_CHANGED }),
            ]);
        });

        const tokenPairWithSession = await this.tokenPort.generateTokens(
            { id, type: PrincipalType.ADMIN, permissions: admin.permissions },
            admin.sessionVersion,
        );

        // The password is already committed. Session unavailability cannot undo it; event
        // reconciliation remains responsible for propagating the session version mirror.
        try {
            if (!(await this.sessionPort.openSession(id, tokenPairWithSession.session))) {
                return { session: 'login_required' };
            }
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.DEPENDENCY_UNAVAILABLE)) {
                return { session: 'login_required' };
            }

            throw error;
        }

        return {
            session: 'created',
            accessToken: tokenPairWithSession.accessToken,
            refreshToken: tokenPairWithSession.refreshToken,
        };
    }
}
