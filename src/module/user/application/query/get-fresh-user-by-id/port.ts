/**
 * @file port.ts
 * @description Outbound port for GetFreshUserByIdQuery.
 */

import type { GetFreshUserByIdResult } from 'src/module/user/application/query/get-fresh-user-by-id/query';

/**
 * Dependency injection token representing the {@link IGetFreshUserByIdPort} contract.
 */
export const TOKEN_GET_FRESH_USER_BY_ID_PORT = Symbol('TOKEN_GET_FRESH_USER_BY_ID_PORT');

/**
 * Primary read contract for the user projection returned after a mutation.
 */
export interface IGetFreshUserByIdPort {
    /**
     * Retrieves the public user read-model by their unique identifier.
     *
     * @param id The unique identifier of the target user
     * @returns The user projection, or null if no non-deleted user is found
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getById(id: string): Promise<GetFreshUserByIdResult | null>;
}
