/**
 * @file handler.ts
 * @description Handles the LogoutAllCommand by closing all active refresh sessions for the specified identity.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { LogoutAllCommand } from 'src/module/auth/application/command/logout-all/command';

/**
 * Handler for the LogoutAllCommand.
 * Revokes all refresh sessions belonging to the user/admin.
 */
@CommandHandler(LogoutAllCommand)
export class LogoutAllCommandHandler implements ICommandHandler<LogoutAllCommand> {
    constructor(
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the logout all command by deleting every refresh session for the principal, so no
     * device can mint new tokens. Already-issued access tokens expire on their own short TTL.
     *
     * @param command The logout all command parameters
     */
    async execute(command: LogoutAllCommand) {
        await this.sessionPort.closeAllSessions(command.sub);

        // Recorded as LOGOUT_ALL rather than LOGOUT so the trail keeps the account-wide revocation
        // distinct from a single-device sign-out — a different fact for an auditor. No `targetId`:
        // `sub` is taken straight from the access token, so it is the actor the context already names.
        this.auditPort.record({ action: AuditAction.LOGOUT_ALL });
    }
}
