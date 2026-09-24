/**
 * @file query.ts
 * @description Query that resolves an admin's authentication state (ban status, session counters, permissions).
 */

import { Query } from '@nestjs/cqrs';
import type { Permission } from 'src/shared/domain/principal';

/**
 * Fetches the authentication state of an admin by their unique identifier.
 */
export class GetAdminAuthStateQuery extends Query<GetAdminAuthStateResult> {
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
 * What token refresh needs: the ban status and the revocation version it rejects dead sessions by,
 * the session version it mints the new pair at, and the permissions the fresh access token must carry.
 */
export type GetAdminAuthStateResult = {
    /**
     * Whether the account is barred from authentication.
     */
    readonly isBanned: boolean;

    /**
     * Current session version used for newly issued access tokens.
     */
    readonly sessionVersion: number;

    /**
     * Minimum version accepted for refresh tokens.
     */
    readonly revocationVersion: number;

    /**
     * Permissions currently assigned to the account.
     */
    readonly permissions: readonly Permission[];
};
