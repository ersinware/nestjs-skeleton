/**
 * @file command.ts
 * @description Defines the ReconcileAdminSessionCommand, dispatched when an admin's access-relevant
 * state changes so the module can push the current DB session version into Redis.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to reconcile an admin's Redis session version with the database. Deriving the version from
 * the re-readable database (rather than the triggering event) makes the outcome converge under
 * duplicate, out-of-order, and concurrent delivery regardless of the event verb.
 */
export class ReconcileAdminSessionCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin whose session version must be reconciled
     */
    constructor(readonly id: string) {
        super();
    }
}
