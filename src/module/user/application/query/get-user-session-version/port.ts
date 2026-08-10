/**
 * @file port.ts
 * @description Outbound query port that reads a user's session version.
 */

import type { GetUserSessionVersionResult } from 'src/module/user/application/query/get-user-session-version/query';

/**
 * Dependency injection token representing the {@link IGetUserSessionVersionPort} contract.
 */
export const TOKEN_GET_USER_SESSION_VERSION_PORT = Symbol('TOKEN_GET_USER_SESSION_VERSION_PORT');

/**
 * Thin read contract for fetching the session version of a user.
 */
export interface IGetUserSessionVersionPort {
    /**
     * Reads the session version of a user by id without the soft-delete filter, so a
     * deleted or missing account resolves to null rather than being hidden or throwing.
     *
     * @param id The unique identifier of the target user
     * @returns The session version, or null when no row exists
     */
    getSessionVersion(id: string): Promise<GetUserSessionVersionResult | null>;
}
