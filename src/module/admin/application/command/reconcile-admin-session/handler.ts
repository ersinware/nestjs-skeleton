/**
 * @file handler.ts
 * @description Reconciles an admin's persisted session version with the session store.
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
 * Pushes the current database session version to the session store.
 */
@CommandHandler(ReconcileAdminSessionCommand)
export class ReconcileAdminSessionCommandHandler implements ICommandHandler<ReconcileAdminSessionCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param sessionVersionPort The port that reads the admin's session version, including soft-deleted rows
     * @param sessionPort The port that writes the session version to Redis
     */
    constructor(
        @Inject(TOKEN_GET_ADMIN_SESSION_VERSION_PORT)
        private readonly sessionVersionPort: IGetAdminSessionVersionPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
    ) {}

    /**
     * Reconciles the session version for the requested admin.
     *
     * @param command The command payload
     */
    async execute(command: ReconcileAdminSessionCommand) {
        const result = await this.sessionVersionPort.getSessionVersion(command.id);

        // Admins are only ever soft-deleted, so a missing row means there is nothing to reconcile.
        if (!result) {
            return;
        }

        await this.sessionPort.setVersion(command.id, result.sessionVersion);
    }
}
