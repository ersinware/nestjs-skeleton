/**
 * @file command.ts
 * @description Defines the ReconcileUserSessionCommand, dispatched when a user's access-relevant state
 * changes so the module can push the current DB session version into Redis.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to reconcile a user's Redis session version with the database. Deriving the version from the
 * re-readable database (rather than the triggering job) makes the outcome converge under duplicate,
 * out-of-order, and concurrent delivery.
 */
export class ReconcileUserSessionCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the user whose session version must be reconciled
     */
    constructor(readonly id: string) {
        super();
    }
}
