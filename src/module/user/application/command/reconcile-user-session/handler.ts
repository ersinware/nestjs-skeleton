/**
 * @file handler.ts
 * @description Handles ReconcileUserSessionCommand by reading the user's current DB session version
 * (including soft-deleted rows) and pushing it into Redis, so a revocation converges regardless of the
 * event verb that triggered it.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { ReconcileUserSessionCommand } from 'src/module/user/application/command/reconcile-user-session/command';
import {
    TOKEN_GET_USER_ACCESS_PROJECTION_PORT,
    type IGetUserAccessProjectionPort,
} from 'src/module/user/application/query/get-user-access-projection/port';

/**
 * Pushes the user's current DB session version into Redis. Reading the version from the database makes
 * the outcome converge under duplicate, out-of-order, and concurrent delivery regardless of the event
 * verb. No inbox is used: the write is monotonic-max and its input derives from the re-readable
 * database (CLAUDE.md §8). Reads run on the handler's own port, never the QueryBus.
 */
@CommandHandler(ReconcileUserSessionCommand)
export class ReconcileUserSessionCommandHandler implements ICommandHandler<ReconcileUserSessionCommand> {
    /**
     * Initializes the handler with the session and access-projection ports.
     *
     * @param sessionPort The service managing the session version in Redis.
     * @param accessProjectionPort The query port that reads the user's session version, including soft-deleted rows.
     */
    constructor(
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_GET_USER_ACCESS_PROJECTION_PORT)
        private readonly accessProjectionPort: IGetUserAccessProjectionPort,
    ) {}

    /**
     * Executes the reconcile-user-session command.
     *
     * @param command The command payload carrying the user id.
     */
    async execute(command: ReconcileUserSessionCommand) {
        const projection = await this.accessProjectionPort.getAccessProjection(command.id);

        // A missing row means the account never existed — nothing to reconcile.
        if (!projection) {
            return;
        }

        await this.sessionPort.setVersion(command.id, projection.version);
    }
}
