/**
 * @file handler.ts
 * @description Verifies user activation proof and commits activation requiring a new sign-in.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_IDEMPOTENCY_PORT, type IIdempotencyPort } from 'src/core/idempotency';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { ActivateUserCommand } from 'src/module/user/application/command/activate-user/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { UserAuditAction } from 'src/module/user/shared/user-audit';
import {
    ExceptionKind,
    InvalidInputException,
    ResourceNotFoundException,
    isExceptionOfKind,
    isExceptionWithAudit,
} from 'src/shared/exception';

/**
 * Activates against current primary account state without issuing session credentials.
 */
@CommandHandler(ActivateUserCommand)
export class ActivateUserCommandHandler implements ICommandHandler<ActivateUserCommand, void> {
    /**
     * Initializes activation dependencies.
     *
     * @param idempotencyPort Commits the account state and success audit together
     * @param userWriterPort Loads and persists authoritative account state
     * @param tokenPort Verifies the activation proof
     * @param hashingPort Verifies the existing password without replacing its hash
     * @param auditPort Records completed activations and audited refusals
     */
    constructor(
        @Inject(TOKEN_IDEMPOTENCY_PORT) private readonly idempotencyPort: IIdempotencyPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Consumes the activation proof and requires a new sign-in for the activated account.
     *
     * @param command Emailed token and existing password
     * @throws {InvalidInputException} When the proof is invalid, expired, revoked, or the password is wrong
     * @throws {ResourceNotFoundException} When the verified proof refers to a missing account
     * @throws {AccessDeniedException} When the account is banned
     * @throws {ResourceConflictException} When the key belongs to a different request or persistence rejects a conflicting mutation.
     * @throws {SystemException} When the loaded account is deleted or differs from the verified subject
     * @throws {DependencyUnavailableException} When required database or audit persistence is unavailable
     */
    async execute(command: ActivateUserCommand) {
        await this.idempotencyPort.executePrepared(
            command.idempotencyRequest,
            async () => {
                let payload;

                try {
                    payload = await this.tokenPort.verifyActivationToken(command.token);
                } catch (error) {
                    if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                        throw new InvalidInputException('The activation link is invalid or has expired.', {
                            cause: error,
                        });
                    }

                    throw error;
                }

                const user = await this.userWriterPort.load(payload.sub);

                if (!user) {
                    throw new ResourceNotFoundException();
                }

                return {
                    user,
                    payload,
                    passwordMatches: await this.hashingPort.verifyPassword(user.password, command.password),
                };
            },
            async ({ user, payload, passwordMatches }) => {
                try {
                    user.activate(payload, passwordMatches);
                } catch (error) {
                    if (isExceptionWithAudit(error)) {
                        await this.auditPort.record(
                            { ...error.audit, targetId: user.id },
                            { markExceptionAsAudited: error },
                        );
                    }

                    throw error;
                }

                await this.userWriterPort.save(user);
                await this.auditPort.record({ action: UserAuditAction.USER_ACTIVATED, targetId: user.id });

                return { replayResultId: null };
            },
        );
    }
}
