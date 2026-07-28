/**
 * @file port.ts
 * @description Outbound port for GetUserAuthStateQuery.
 */

import type { GetUserAuthStateResult } from 'src/module/user/application/query/get-user-auth-state/query';

export const TOKEN_GET_USER_AUTH_STATE_PORT = Symbol('TOKEN_GET_USER_AUTH_STATE_PORT');

/**
 * Thin read contract for fetching a user's authentication-state read-model.
 */
export interface IGetUserAuthStatePort {
    /**
     * Reads a user's authentication state (active status + session version) by their unique identifier.
     *
     * @param id The unique identifier of the target user
     * @returns The authentication state, or null if no user is found
     */
    getAuthState(id: string): Promise<GetUserAuthStateResult | null>;
}
