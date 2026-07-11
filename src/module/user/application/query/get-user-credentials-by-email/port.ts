/**
 * @file port.ts
 * @description Outbound port for GetUserCredentialsByEmailQuery.
 */

import type { GetUserCredentialsByEmailResult } from 'src/module/user/application/query/get-user-credentials-by-email/query';

export const TOKEN_GET_USER_CREDENTIALS_BY_EMAIL_PORT = Symbol('TOKEN_GET_USER_CREDENTIALS_BY_EMAIL_PORT');

export interface IGetUserCredentialsByEmailPort {
    /**
     * Retrieves credential fields for a user by their email address.
     *
     * @param email The exact email address to query
     * @returns The user credentials projection, or null if no active user is found
     */
    getCredentialsByEmail(email: string): Promise<GetUserCredentialsByEmailResult | null>;
}
