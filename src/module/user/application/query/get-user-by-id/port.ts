/**
 * @file port.ts
 * @description Outbound port for GetUserByIdQuery.
 */

import type { GetUserByIdResult } from 'src/module/user/application/query/get-user-by-id/query';

export const TOKEN_GET_USER_BY_ID_PORT = Symbol('TOKEN_GET_USER_BY_ID_PORT');

/**
 * Thin read contract for fetching a single user's read-model by identifier.
 */
export interface IGetUserByIdPort {
    /**
     * Retrieves the public user read-model by their unique identifier.
     *
     * @param id The unique identifier of the target user
     * @returns The user projection, or null if no active user is found
     */
    getById(id: string): Promise<GetUserByIdResult | null>;
}
