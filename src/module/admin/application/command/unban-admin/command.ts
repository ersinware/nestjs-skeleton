/**
 * @file command.ts
 * @description Command that lifts the ban on an admin account.
 */

import { Command } from '@nestjs/cqrs';
import type { Principal } from 'src/shared/domain/principal';

/**
 * Lifts the ban on an admin account.
 */
export class UnbanAdminCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin to unban
     * @param actor The verified principal performing the action, weighed against the target by the aggregate
     */
    constructor(
        readonly id: string,
        readonly actor: Principal,
    ) {
        super();
    }
}
