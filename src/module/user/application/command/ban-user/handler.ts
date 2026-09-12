/**
 * @file handler.ts
 * @description Handles BanUserCommand. Bans the User aggregate root and persists it, then instantly
 * evicts existing sessions on a best-effort basis.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { BanUserCommand } from 'src/module/user/application/command/ban-user/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { ExceptionKind, ResourceNotFoundException, isExceptionOfKind } from 'src/shared/exception';

/**
 * Bans an existing user, revoking all of their active sessions.
 */
@CommandHandler(BanUserCommand)
export class BanUserCommandHandler implements ICommandHandler<BanUserCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param userWriterPort The port used to load and save the user aggregate
     * @param sessionPort The port used to push the session version to Redis
     * @param auditPort The port used to record the ban for the audit trail
     * @param errorReporterPort The port used to report unexpected background session failures
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_ERROR_REPORTER_PORT) private readonly errorReporterPort: IErrorReporterPort,
    ) {}

    /**
     * Executes the ban user command.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the user does not exist
     */
    async execute(command: BanUserCommand) {
        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        // On an already-banned account `ban()` is a no-op: nothing changed, so there is nothing to
        // persist, audit, or evict.
        if (!user.ban(command.actor)) {
            return;
        }

        await this.userWriterPort.save(user);
        await this.auditPort.record({ action: AuditAction.USER_BANNED, targetId: user.id });

        // Best-effort instant eviction, fire-and-forget: the DB version already denies the next
        // refresh, so the response does not wait on Redis.
        void this.sessionPort.setVersion(user.id, user.sessionVersion).catch((error: unknown) => {
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
