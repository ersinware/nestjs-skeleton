/**
 * @file handler.ts
 * @description Handles ChangeUserPasswordCommand. Verifies the current password before changing it and revoking every session.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import {
    ChangeUserPasswordCommand,
    ChangeUserPasswordMessage,
    type ChangeUserPasswordResult,
} from 'src/module/user/application/command/change-user-password/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { PrincipalType } from 'src/shared/domain/principal';
import {
    AccessDeniedException,
    ExceptionKind,
    InvalidInputException,
    ResourceNotFoundException,
    isExceptionOfKind,
} from 'src/shared/exception';

/**
 * Changes the password for an existing user account.
 */
@CommandHandler(ChangeUserPasswordCommand)
export class ChangeUserPasswordCommandHandler implements ICommandHandler<
    ChangeUserPasswordCommand,
    ChangeUserPasswordResult
> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and save the user aggregate
     * @param hashingPort The port used to verify and hash passwords
     * @param sessionPort The port used to synchronize the version and open a fresh session
     * @param auditPort The port used to record the password change for the audit trail
     * @param tokenPort The port used to sign the replacement token pair
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
    ) {}

    /**
     * Executes the change user password command.
     * Checks the loaded account's ban state before password verification because the guard's
     * Redis version may lag behind a committed ban. Issuing tokens at the newly advanced version
     * would otherwise give that banned account access that later reconciliation would not revoke.
     *
     * @param command The command payload
     * @returns The committed password change and its session outcome
     * @throws {ResourceNotFoundException} When the user does not exist
     * @throws {AccessDeniedException} When the loaded account is banned
     * @throws {InvalidInputException} When the current password is invalid or the new password is the same
     */
    async execute(command: ChangeUserPasswordCommand): Promise<ChangeUserPasswordResult> {
        const { id, currentPassword, newPassword } = command,
            user = await this.userWriterPort.load(id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        if (user.isBanned) {
            throw new AccessDeniedException();
        }

        const hashedPassword = user.password;

        if (!(await this.hashingPort.verify(hashedPassword, currentPassword))) {
            throw new InvalidInputException(ChangeUserPasswordMessage.CURRENT_PASSWORD_MISMATCH);
        }

        if (await this.hashingPort.verify(hashedPassword, newPassword)) {
            throw new InvalidInputException(ChangeUserPasswordMessage.PASSWORD_REUSE);
        }

        user.changePassword(await this.hashingPort.hash(newPassword));
        await this.userWriterPort.save(user);
        await this.auditPort.record({ action: AuditAction.PASSWORD_CHANGED });

        const tokens = await this.tokenPort.generateTokens(
            { id, type: PrincipalType.USER, permissions: user.permissions },
            user.sessionVersion,
        );

        // The password is already committed. Session unavailability cannot undo it; event
        // reconciliation remains responsible for propagating the session version mirror.
        try {
            if (!(await this.sessionPort.openSessionAtVersion(id, tokens.refreshTokenJti, user.sessionVersion))) {
                return { session: 'login_required' };
            }
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.DEPENDENCY_UNAVAILABLE)) {
                return { session: 'login_required' };
            }

            throw error;
        }

        return { session: 'created', accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }
}
