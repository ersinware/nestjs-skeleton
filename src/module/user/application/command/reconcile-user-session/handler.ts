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
    TOKEN_GET_USER_SESSION_VERSION_PORT,
    type IGetUserSessionVersionPort,
} from 'src/module/user/application/query/get-user-session-version/port';

/**
 * Pushes the user's current DB session version into Redis. Reading the version from the database makes
 * the outcome converge under duplicate, out-of-order, and concurrent delivery regardless of the event
 * verb. No inbox is used: the write is monotonic-max and its input derives from the re-readable
 * database (CLAUDE.md §8). Reads run on the handler's own port, never the QueryBus.
 */
@CommandHandler(ReconcileUserSessionCommand)
export class ReconcileUserSessionCommandHandler implements ICommandHandler<ReconcileUserSessionCommand, void> {
    /**
     * Initializes the handler with the session and session-version ports.
     *
     * @param sessionPort The service managing the session version in Redis.
     * @param sessionVersionPort The query port that reads the user's session version, including soft-deleted rows.
     */
    constructor(
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_GET_USER_SESSION_VERSION_PORT)
        private readonly sessionVersionPort: IGetUserSessionVersionPort,
    ) {}

    /**
     * Executes the reconcile-user-session command.
     *
     * @param command The command payload carrying the user id.
     */
    async execute(command: ReconcileUserSessionCommand) {
        const sessionVersion = await this.sessionVersionPort.getSessionVersion(command.id);

        // A missing row means the account never existed — nothing to reconcile.
        if (!sessionVersion) {
            return;
        }

        await this.sessionPort.setVersion(command.id, sessionVersion.version);
    }
}
