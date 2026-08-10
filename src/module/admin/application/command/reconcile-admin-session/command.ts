/**
 * @file command.ts
 * @description Command that reconciles an admin's Redis session version with the database.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Reconciles an admin's Redis session version with the database. Carries only the id: the handler
 * re-reads the version from the DB, so the outcome converges under duplicate, out-of-order, and
 * concurrent delivery regardless of the triggering event.
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
