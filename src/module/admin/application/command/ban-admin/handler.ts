/**
 * @file handler.ts
 * @description Handles the BanAdminCommand by banning the admin account, preventing bans on super-admins.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { BanAdminCommand } from 'src/module/admin/application/command/ban-admin/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { AdminRole } from 'src/shared/domain/admin';
import { AccessDeniedException, ResourceNotFoundException } from 'src/shared/exception';

/**
 * Handler for the BanAdminCommand.
 * Bans the admin account while enforcing authorization rules, revoking all of its active sessions.
 */
@CommandHandler(BanAdminCommand)
export class BanAdminCommandHandler implements ICommandHandler<BanAdminCommand> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param adminWriterPort The port used to load and persist the admin aggregate
     * @param sessionPort The port used to revoke the banned admin's sessions
     * @param auditPort The port used to record the ban
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the ban admin command.
     *
     * @param command The ban admin command parameters
     * @throws {ResourceNotFoundException} When the target admin does not exist.
     * @throws {AccessDeniedException} When attempting to ban a super administrator.
     */
    async execute(command: BanAdminCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            throw new ResourceNotFoundException();
        }

        if (admin.role === AdminRole.SUPER_ADMIN) {
            throw new AccessDeniedException();
        }

        // `ban()` is a silent no-op on an already-banned account and reports whether it actually
        // transitioned. On a no-op there is nothing to persist, audit, or evict: re-writing identical
        // values and re-pushing the eviction would be pure noise — and because the setVersion failure
        // below is swallowed and silent, "re-ban to retry a lost eviction" was never an actionable
        // path anyway; a real ban stays effective within one access-token TTL regardless, since
        // refresh is refused for a banned identity.
        if (!admin.ban()) {
            return;
        }

        await this.adminWriterPort.save(admin);

        // Recorded once the write is durable, and before the best-effort eviction below: the ban is
        // already a fact at this point, and an unreachable Redis must not cost the trail its only
        // evidence of who imposed it. The actor comes from the ambient audit context, not from here.
        this.auditPort.record({ action: AuditAction.ADMIN_BANNED, targetId: command.id });

        try {
            await this.sessionPort.setVersion(command.id, admin.version);
        } catch {
            // Best-effort instant eviction.
        }
    }
}
