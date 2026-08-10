/**
 * @file query.ts
 * @description Query that resolves a user's authentication state (active status + session version).
 */

import { Query } from '@nestjs/cqrs';

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
 * The expected result of the GetUserAuthStateQuery: the account's ban status and current session
 * version, used together by token refresh to reject banned or superseded sessions.
 */
export type GetUserAuthStateResult = {
    isBanned: boolean;
    version: number;
};
