/**
 * @file admin-identity-reader.port.ts
 * @description Contract for services that provide Admin identity lookup for authentication.
 */

import { AdminRole } from 'src/shared/domain/admin';

export const TOKEN_ADMIN_IDENTITY_READER_PORT = Symbol('TOKEN_ADMIN_IDENTITY_READER_PORT');

/**
 * The admin identity contract required by the AuthModule.
 * Decouples authentication logic from specific domain entities.
 */
export type AuthAdminIdentity = {
    /** The unique identifier of the identity */
    id: string;

    /** The hashed password of the identity */
    password: string;

    /** The ban status of the identity */
    isBanned: boolean;

    /** The explicit authorization role of the administrative identity */
    role: AdminRole;

    /** The current session version, embedded into freshly minted tokens */
    version: number;
};

export interface IAdminIdentityReaderPort {
    /**
     * Looks up an admin strictly by their email address.
     *
     * @param email The email address to search for
     * @returns The associated admin identity
     * @throws {ResourceNotFoundException} If no identity is found
     */
    getCredentialsByEmail(email: string): Promise<AuthAdminIdentity>;

    /**
     * Retrieves an admin's ban status and current session version by their unique identifier.
     *
     * @param id The unique identifier of the target identity
     * @returns The ban status and current session version
     * @throws {ResourceNotFoundException} If no identity is found
     */
    getAuthState(id: string): Promise<{ isBanned: boolean; version: number }>;
}
