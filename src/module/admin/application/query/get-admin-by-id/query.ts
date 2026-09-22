/**
 * @file query.ts
 * @description Query that resolves the public read-model for an admin by their unique identifier.
 */

import { Query } from '@nestjs/cqrs';
import type { Permission } from 'src/shared/domain/principal';

/**
 * Fetches the public admin projection by unique identifier, tolerating replication lag.
 */
export class GetAdminByIdQuery extends Query<GetAdminByIdResult> {
    /**
     * Initializes the query with its parameters.
     *
     * @param id The unique identifier of the admin
     */
    constructor(readonly id: string) {
        super();
    }
}

/**
 * The public admin projection — the client-safe fields only, never the password hash.
 */
export type GetAdminByIdResult = {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly permissions: readonly Permission[];
    readonly isBanned: boolean;
    readonly isActivated: boolean;
};
