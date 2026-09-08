/**
 * @file command.ts
 * @description Command that bans an admin account.
 */

import { Command } from '@nestjs/cqrs';
import type { Principal } from 'src/shared/domain/principal';

/**
 * Bans an admin account.
 */
export class BanAdminCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin to ban
     * @param actor The verified principal performing the action, weighed against the target by the aggregate
     */
    constructor(
        readonly id: string,
        readonly actor: Principal,
    ) {
        super();
    }
}
