/**
 * @file port.ts
 * @description Primary-database existence check for a user identity.
 */

import type { UserExistsResult } from 'src/module/user/application/query/user-exists/query';

/**
 * Identifies the {@link IUserExistsPort} account existence contract.
 */
export const TOKEN_USER_EXISTS_PORT = Symbol();

/**
 * Checks persisted account identities without loading an aggregate.
 */
export interface IUserExistsPort {
    /**
     * Includes deleted accounts because the primary key also includes them.
     *
     * @param id Account identity to check
     * @returns Whether the identity is already persisted
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    existsById(id: string): Promise<UserExistsResult>;
}
