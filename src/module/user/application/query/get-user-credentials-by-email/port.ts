/**
 * @file port.ts
 * @description Outbound port for GetUserCredentialsByEmailQuery.
 */

import type { GetUserCredentialsByEmailResult } from 'src/module/user/application/query/get-user-credentials-by-email/query';

/**
 * Dependency injection token representing the {@link IGetUserCredentialsByEmailPort} contract.
 */
export const TOKEN_GET_USER_CREDENTIALS_BY_EMAIL_PORT = Symbol('TOKEN_GET_USER_CREDENTIALS_BY_EMAIL_PORT');

/**
 * Thin read contract for fetching a user's credential read-model by email.
 */
export interface IGetUserCredentialsByEmailPort {
    /**
     * Retrieves credential fields for a user by their email address.
     *
     * @param email The exact email address to query
     * @returns The user credentials projection, or null if no active user is found
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getCredentialsByEmail(email: string): Promise<GetUserCredentialsByEmailResult | null>;
}
