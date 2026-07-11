/**
 * @file port.ts
 * @description Outbound port for GetUserCredentialsByIdQuery.
 */

import type { GetUserCredentialsByIdResult } from 'src/module/user/application/query/get-user-credentials-by-id/query';

export const TOKEN_GET_USER_CREDENTIALS_BY_ID_PORT = Symbol('TOKEN_GET_USER_CREDENTIALS_BY_ID_PORT');

export interface IGetUserCredentialsByIdPort {
    /**
     * Retrieves credential fields for a user by their unique identifier.
     *
     * @param id The unique identifier of the target user
     * @returns The user credentials projection, or null if no active user is found
     */
    getCredentialsById(id: string): Promise<GetUserCredentialsByIdResult | null>;
}
