/**
 * @file query.ts
 * @description Query that resolves whether a user is active or not.
 */

import { Query } from '@nestjs/cqrs';

/**
 * Fetches the active status of a user by their unique identifier.
 */
export class CheckUserIsActiveQuery extends Query<CheckUserIsActiveResult> {
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
 * The expected result of the CheckUserIsActiveQuery, returning a boolean active status.
 */
export type CheckUserIsActiveResult = boolean;
