/**
 * @file query.ts
 * @description Query that resolves the public read-model for a user by their unique identifier.
 */

import { Query } from '@nestjs/cqrs';

/**
 * Fetches the public user projection by unique identifier.
 */
export class GetUserByIdQuery extends Query<GetUserByIdResult> {
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
 * The expected result of the GetUserByIdQuery, returning the read model.
 * Does not expose sensitive fields such as the hashed password.
 */
export type GetUserByIdResult = {
    id: string;
    email: string;
    name: string;
    isBanned: boolean;
    createdAt: Date;
    updatedAt: Date;
};
