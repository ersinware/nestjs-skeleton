/**
 * @file query.ts
 * @description Query that resolves the credentials read-model for a user by their email address.
 */

import { Query } from '@nestjs/cqrs';
import type { Permission } from 'src/shared/domain/principal';

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
    /**
     * Identifier of the account represented by this row.
     */
    readonly id: string;

    /**
     * Stored password hash used for credential verification.
     */
    readonly password: string;

    /**
     * Whether the account must complete email activation before a session can open.
     */
    readonly requiresActivation: boolean;

    /**
     * Permissions currently assigned to the account.
     */
    readonly permissions: readonly Permission[];

    /**
     * Whether the account is barred from authentication.
     */
    readonly isBanned: boolean;

    /**
     * Current session version used for newly issued access tokens.
     */
    readonly sessionVersion: number;
};
