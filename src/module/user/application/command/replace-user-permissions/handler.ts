/**
 * @file handler.ts
 * @description Handles ReplaceUserPermissionsCommand. Applies the new permission set to the User aggregate, persists it, and cuts the sessions that carried the old set.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { ReplaceUserPermissionsCommand } from 'src/module/user/application/command/replace-user-permissions/command';
import { UserAuditAction } from 'src/module/user/shared/user-audit';
import { PrincipalType } from 'src/shared/domain/principal';
import {
    ExceptionKind,
    ResourceNotFoundException,
    isExceptionOfKind,
    isExceptionWithAudit,
} from 'src/shared/exception';

/**
 * Replaces a user's permission set. The aggregate validates the set against the user catalog;
 * this handler persists the outcome and records the evidence.
 */
@CommandHandler(ReplaceUserPermissionsCommand)
export class ReplaceUserPermissionsCommandHandler implements ICommandHandler<ReplaceUserPermissionsCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param transactionPort The commit boundary for the business write and audit
     * @param userWriterPort The port used to load and persist the user aggregate
     * @param sessionPort The port used to push the bumped session version to Redis
     * @param auditPort The port used to record the change
     * @param errorReporterPort The port used to report unexpected background session failures
     */
    constructor(
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_ERROR_REPORTER_PORT) private readonly errorReporterPort: IErrorReporterPort,
    ) {}

    /**
     * Replaces the complete permission set.
     *
     * @param command The command payload
     * @throws {ResourceNotFoundException} When the target user does not exist.
     * @throws {InvalidInputException} When the set holds a permission a user may not hold.
     * @throws {DependencyUnavailableException} When a required database operation, including audit persistence, is unavailable
     * @throws {ResourceConflictException} When persistence rejects a concurrent modification
     * @throws {SystemException} When an account or actor invariant is violated, or required jobs are not accepted
     */
    async execute(command: ReplaceUserPermissionsCommand) {
        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            throw new ResourceNotFoundException();
        }

        // A set that already holds changes nothing: nothing to persist, audit, or evict.
        let change;

        try {
            change = user.changePermissions(command.permissions, command.actor);
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: user.id }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        if (!change) {
            return;
        }

        await this.transactionPort.run(async () => {
            await this.userWriterPort.save(user);
            await this.auditPort.record({
                action: UserAuditAction.USER_PERMISSIONS_CHANGED,
                targetId: user.id,
                detail: { granted: change.granted, revoked: change.revoked },
            });
        });

        // Best-effort instant eviction, fire-and-forget: the DB version already denies the next
        // refresh, so the response does not wait on Redis.
        void this.sessionPort.setVersion(user.id, PrincipalType.USER, user.sessionVersion).catch((error: unknown) => {
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
