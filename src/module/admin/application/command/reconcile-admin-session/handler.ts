/**
 * @file handler.ts
 * @description Handles ReconcileAdminSessionCommand by reading the admin's current DB session version
 * (including soft-deleted rows) and pushing it into Redis, so a revocation converges regardless of the
 * event verb that triggered it.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { ReconcileAdminSessionCommand } from 'src/module/admin/application/command/reconcile-admin-session/command';
import {
    TOKEN_GET_ADMIN_ACCESS_PROJECTION_PORT,
    type IGetAdminAccessProjectionPort,
} from 'src/module/admin/application/query/get-admin-access-projection/port';

/**
 * Pushes the admin's current DB session version into Redis. Reading the version from the database makes
 * the outcome converge under duplicate, out-of-order, and concurrent delivery regardless of the event
 * verb. No inbox is used: the write is monotonic-max and its input derives from the re-readable
 * database (CLAUDE.md §8). Reads run on the handler's own port, never the QueryBus.
 */
@CommandHandler(ReconcileAdminSessionCommand)
export class ReconcileAdminSessionCommandHandler implements ICommandHandler<ReconcileAdminSessionCommand> {
    /**
     * Initializes the handler with the session and admin access-projection ports.
     *
     * @param sessionPort The service managing the session version in Redis.
     * @param accessProjectionPort The query port that reads the admin's session version, including soft-deleted rows.
     */
    constructor(
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_GET_ADMIN_ACCESS_PROJECTION_PORT)
        private readonly accessProjectionPort: IGetAdminAccessProjectionPort,
    ) {}

    /**
     * Executes the reconcile-admin-session command.
     *
     * @param command The command payload carrying the admin id.
     */
    async execute(command: ReconcileAdminSessionCommand) {
        const projection = await this.accessProjectionPort.getAdminAccessProjection(command.id);

        // Admins are only ever soft-deleted, so a missing row means there is nothing to reconcile.
        if (!projection) {
            return;
        }

        await this.sessionPort.setVersion(command.id, projection.version);
    }
}
