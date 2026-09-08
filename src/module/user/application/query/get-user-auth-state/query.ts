/**
 * @file query.ts
 * @description Query that resolves a user's authentication state (ban status, session counters, permissions).
 */

import { Query } from '@nestjs/cqrs';
import type { Permission } from 'src/shared/domain/principal';

/**
 * Fetches the authentication state of a user by their unique identifier.
 */
export class GetUserAuthStateQuery extends Query<GetUserAuthStateResult> {
    /**
     * Initializes the query with its parameters.
     *
     * @param id The unique identifier of the user
     */
    constructor(readonly id: string) {
        super();
    }
}

/**
 * What token refresh needs: the ban status and the revocation version it rejects dead sessions by,
 * the session version it mints the new pair at, and the permissions the fresh access token must carry.
 */
export type GetUserAuthStateResult = {
    readonly isBanned: boolean;
    readonly sessionVersion: number;
    readonly revocationVersion: number;
    readonly permissions: readonly Permission[];
};
