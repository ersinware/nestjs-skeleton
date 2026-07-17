/**
 * @file query.ts
 * @description Query that resolves an admin's authentication state (active status + session version).
 */

import { Query } from '@nestjs/cqrs';

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
 * The expected result of the GetAdminAuthStateQuery: the account's ban status and current session
 * version, used together by token refresh to reject banned or superseded sessions.
 */
export type GetAdminAuthStateResult = {
    isBanned: boolean;
    version: number;
};
