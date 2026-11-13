/**
 * @file handler.ts
 * @description Handles ChangeUserPasswordCommand. Verifies the current password before changing it and revoking every session.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_IDEMPOTENCY_PORT, type IIdempotencyPort } from 'src/core/idempotency';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { ChangeUserPasswordCommand } from 'src/module/user/application/command/change-user-password/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { PrincipalAuditAction } from 'src/shared/domain/principal';
import { ResourceNotFoundException, isExceptionWithAudit } from 'src/shared/exception';

/**
 * Changes the password for an existing user account.
 */
@CommandHandler(ChangeUserPasswordCommand)
export class ChangeUserPasswordCommandHandler implements ICommandHandler<ChangeUserPasswordCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param idempotencyPort The commit boundary for the business write and audit
     * @param userWriterPort The port used to load and save the user aggregate
     * @param hashingPort The port used to verify and hash passwords
     * @param auditPort The port used to record the password change for the audit trail
     */
    constructor(
        @Inject(TOKEN_IDEMPOTENCY_PORT) private readonly idempotencyPort: IIdempotencyPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the change user password command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the user does not exist
     * @throws {AccessDeniedException} When the loaded account is banned
     * @throws {InvalidInputException} When the current password is invalid or the new password is the same
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When the key belongs to a different request or persistence rejects a conflicting mutation.
     * @throws {SystemException} When the loaded account violates the mutation contract or required jobs are not accepted
     */
    async execute(command: ChangeUserPasswordCommand) {
        await this.idempotencyPort.executePrepared(
            command.idempotencyRequest,
            async () => {
                const { newPassword } = command,
                    user = await this.userWriterPort.load(command.id);

                if (!user) {
                    throw new ResourceNotFoundException();
                }

                const hashedPassword = user.password;

                return {
                    user,
                    hashedNewPassword: await this.hashingPort.hashPassword(newPassword),
                    currentPasswordMatches: await this.hashingPort.verifyPassword(
                        hashedPassword,
                        command.currentPassword,
                    ),
                    newPasswordMatches: await this.hashingPort.verifyPassword(hashedPassword, newPassword),
                };
            },
            async ({ user, hashedNewPassword, currentPasswordMatches, newPasswordMatches }) => {
                try {
                    user.changePassword(hashedNewPassword, currentPasswordMatches, newPasswordMatches);
                } catch (error) {
                    if (isExceptionWithAudit(error)) {
                        await this.auditPort.record({ ...error.audit }, { markExceptionAsAudited: error });
                    }

                    throw error;
                }

                await this.userWriterPort.save(user);
                await this.auditPort.record({ action: PrincipalAuditAction.PASSWORD_CHANGED });

                return { replayResultId: null };
            },
        );
    }
}
