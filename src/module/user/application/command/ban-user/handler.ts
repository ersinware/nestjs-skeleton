/**
 * @file handler.ts
 * @description Handles BanUserCommand. Bans the User aggregate root and persists it, then instantly
 * evicts existing sessions on a best-effort basis.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { BanUserCommand } from 'src/module/user/application/command/ban-user/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { ResourceNotFoundException } from 'src/shared/exception';

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
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
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

        // `ban()` is a silent no-op on an already-banned account, so the state is read BEFORE it to
        // tell a real transition from a repeated request. The audit trail follows the same truth as
        // the domain event: an entry for a ban that changed nothing would be a fabricated fact.
        // `ban()` is a silent no-op on an already-banned account and reports whether it actually
        // transitioned. On a no-op there is nothing to persist, audit, or evict: re-writing identical
        // values and re-pushing the eviction would be pure noise — and because the setVersion failure
        // below is swallowed and silent, "re-ban to retry a lost eviction" was never an actionable
        // path anyway; a real ban stays effective within one access-token TTL regardless, since
        // refresh is refused for a banned identity.
        if (!user.ban()) {
            return;
        }

        await this.userWriterPort.save(user);

        // Recorded once the write is durable, and before the best-effort eviction below: the ban is
        // already a fact at this point, and an unreachable Redis must not cost the trail its only
        // evidence of who imposed it. The actor comes from the ambient audit context, not from here.
        this.auditPort.record({ action: AuditAction.USER_BANNED, targetId: command.id });

        // Best-effort instant eviction, fire-and-forget: the DB version already denies the next
        // refresh, so the response does not wait on Redis. The catch only stops an unhandled rejection.
        this.sessionPort.setVersion(command.id, user.version).catch(() => {});
    }
}
