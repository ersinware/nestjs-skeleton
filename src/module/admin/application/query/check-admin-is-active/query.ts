/**
 * @file check-admin-is-active.query.ts
 * @description Query that resolves only the active status for an admin by ID.
 * Highly optimized for frequent auth checks (e.g., token refresh).
 */

import { Query } from '@nestjs/cqrs';

/**
 * Fetches only the boolean active status for an admin by their unique identifier.
 */
export class CheckAdminIsActiveQuery extends Query<CheckAdminIsActiveResult> {
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
 * The expected result of the CheckAdminIsActiveQuery, returning a boolean active status.
 */
export type CheckAdminIsActiveResult = boolean;
