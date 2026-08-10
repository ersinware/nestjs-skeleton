/**
 * @file handler.ts
 * @description Handler for ReconcileAdminSessionCommand.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { ReconcileAdminSessionCommand } from 'src/module/admin/application/command/reconcile-admin-session/command';
import {
    TOKEN_GET_ADMIN_SESSION_VERSION_PORT,
    type IGetAdminSessionVersionPort,
} from 'src/module/admin/application/query/get-admin-session-version/port';

/**
 * Pushes the admin's current DB session version into Redis. Re-reading the version from the database
 * makes the outcome converge under duplicate, out-of-order, and concurrent delivery, so no inbox is
 * needed: the write is idempotent by construction.
 */
@CommandHandler(ReconcileAdminSessionCommand)
export class ReconcileAdminSessionCommandHandler implements ICommandHandler<ReconcileAdminSessionCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param sessionPort The port that writes the session version to Redis
     * @param sessionVersionPort The port that reads the admin's session version, including soft-deleted rows
     */
    constructor(
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_GET_ADMIN_SESSION_VERSION_PORT)
        private readonly sessionVersionPort: IGetAdminSessionVersionPort,
    ) {}

    /**
     * Executes the reconciliation.
     *
     * @param command The command payload
     */
    async execute(command: ReconcileAdminSessionCommand) {
        const sessionVersion = await this.sessionVersionPort.getSessionVersion(command.id);

        // Admins are only ever soft-deleted, so a missing row means there is nothing to reconcile.
        if (!sessionVersion) {
            return;
        }

        await this.sessionPort.setVersion(command.id, sessionVersion.version);
    }
}
