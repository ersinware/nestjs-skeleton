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
    /**
     * Identifier of the account represented by this row.
     */
    readonly id: string;

    /**
     * Current email address of the account.
     */
    readonly email: string;

    /**
     * Display name of the account.
     */
    readonly name: string;

    /**
     * Avatar object key, or null before activation.
     */
    readonly avatarKey: string | null;

    /**
     * Permissions currently assigned to the account.
     */
    readonly permissions: readonly Permission[];

    /**
     * Whether the account is barred from authentication.
     */
    readonly isBanned: boolean;

    /**
     * Whether the admin has completed activation.
     */
    readonly isActivated: boolean;
};
