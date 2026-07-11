/**
 * @file query.ts
 * @description Query that resolves the credentials read-model for a user by their email address.
 */

import { Query } from '@nestjs/cqrs';

/**
 * Fetches the credential fields for a user by email address.
 */
export class GetUserCredentialsByEmailQuery extends Query<GetUserCredentialsByEmailResult> {
    /**
     * Initializes the query with its parameters.
     *
     * @param email The exact email address to query
     */
    constructor(readonly email: string) {
        super();
    }
}

/**
 * The expected result of the GetUserCredentialsByEmailQuery.
 * Minimal projection used exclusively for authentication credential checks.
 */
export type GetUserCredentialsByEmailResult = {
    id: string;
    password: string;
    isActive: boolean;
};
