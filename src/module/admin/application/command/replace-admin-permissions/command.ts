/**
 * @file command.ts
 * @description Command that replaces an admin's permission set.
 */

import { Command } from '@nestjs/cqrs';
import type { Permission, Principal } from 'src/shared/domain/principal';

/**
 * Replaces an admin's permission set with the given one. Whole-set semantics on purpose: the
 * request states the end state, so it is idempotent, and one command yields one audit record
 * naming everything granted and revoked.
 */
export class ReplaceAdminPermissionsCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin whose permissions change
     * @param permissions The complete permission set the admin should hold afterwards
     * @param actor The verified principal making the change, weighed against the target by the aggregate
     */
    constructor(
        readonly id: string,
        readonly permissions: readonly Permission[],
        readonly actor: Principal,
    ) {
        super();
    }
}
