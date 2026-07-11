/**
 * @file query.ts
 * @description Query that resolves the credentials read-model for a user by their unique identifier.
 */

import { Query } from '@nestjs/cqrs';

/**
 * Fetches the credential fields for a user by unique identifier.
 */
export class GetUserCredentialsByIdQuery extends Query<GetUserCredentialsByIdResult> {
    /**
     * Initializes the query with its parameters.
     *
     * @param id The unique identifier of the target user
     */
    constructor(readonly id: string) {
        super();
    }
}

/**
 * The expected result of the GetUserCredentialsByIdQuery.
 * Minimal projection used exclusively for authentication credential checks.
 */
export type GetUserCredentialsByIdResult = {
    id: string;
    password: string;
    isActive: boolean;
};
