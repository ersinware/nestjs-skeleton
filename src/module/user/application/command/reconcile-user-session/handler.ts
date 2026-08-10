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
 * Pushes the user's current DB session version into Redis. Re-reading the version from the database
 * makes the outcome converge under duplicate, out-of-order, and concurrent delivery, so no inbox is
 * needed: the write is idempotent by construction.
 */
@CommandHandler(ReconcileUserSessionCommand)
export class ReconcileUserSessionCommandHandler implements ICommandHandler<ReconcileUserSessionCommand, void> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param sessionPort The port that writes the session version to Redis
     * @param sessionVersionPort The port that reads the user's session version, including soft-deleted rows
     */
    constructor(
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_GET_USER_SESSION_VERSION_PORT)
        private readonly sessionVersionPort: IGetUserSessionVersionPort,
    ) {}

    /**
     * Executes the reconcile-user-session command.
     *
     * @param command The command payload
     */
    async execute(command: ReconcileUserSessionCommand) {
        const result = await this.sessionVersionPort.getSessionVersion(command.id);

        // Users are only ever soft-deleted, so a missing row means there is nothing to reconcile.
        if (!result) {
            return;
        }

        await this.sessionPort.setVersion(command.id, result.sessionVersion);
    }
}
