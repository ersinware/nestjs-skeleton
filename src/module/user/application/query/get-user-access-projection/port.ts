/**
 * @file port.ts
 * @description Outbound query port that reads a user's access-control projection.
 */

import type { GetUserAccessProjectionResult } from 'src/module/user/application/query/get-user-access-projection/query';

/**
 * Dependency injection token representing the {@link IGetUserAccessProjectionPort} contract.
 */
export const TOKEN_GET_USER_ACCESS_PROJECTION_PORT = Symbol('TOKEN_GET_USER_ACCESS_PROJECTION_PORT');

/**
 * Thin read contract for fetching the access-control projection of a user.
 */
export interface IGetUserAccessProjectionPort {
    /**
     * Reads the access-control projection of a user by id without the soft-delete filter, so a
     * deleted or missing account resolves to null rather than being hidden or throwing.
     *
     * @param id The unique identifier of the target user
     * @returns The projection, or null when no row exists
     */
    getAccessProjection(id: string): Promise<GetUserAccessProjectionResult | null>;
}
