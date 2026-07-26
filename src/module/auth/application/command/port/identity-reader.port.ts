/**
 * @file identity-reader.port.ts
 * @description Contract for looking up an authenticatable identity, from whichever bounded context owns it.
 */

import type { AuthRole } from 'src/core/security/auth';

export const TOKEN_IDENTITY_READER_PORT = Symbol('TOKEN_IDENTITY_READER_PORT');

/**
 * Which bounded context an identity is read from.
 *
 * This is the INPUT that selects the source, and it is deliberately not `AuthRole`: a login knows
 * the realm it authenticates against but not the role the account turns out to hold — an admin may
 * be `ADMIN` or `SUPER_ADMIN`. The role is what the realm REPORTS back, never what selects it.
 */
export enum IdentityRealm {
    USER = 'user',
    ADMIN = 'admin',
}

/**
 * The identity contract required by the AuthModule.
 * Decouples authentication logic from specific domain entities.
 */
export type AuthIdentity = {
    /** The unique identifier of the identity */
    id: string;

    /** The hashed password of the identity */
    password: string;

    /** The ban status of the identity */
    isBanned: boolean;

    /** The authorization role the owning realm reports, embedded into freshly minted tokens */
    role: AuthRole;

    /** The current session version, embedded into freshly minted tokens */
    version: number;
};

/**
 * The single read surface authentication needs over every identity realm.
 *
 * One port rather than one per realm: the realm is a parameter of the lookup, so a handler that
 * resolves it at runtime (token refresh) depends on one contract instead of branching across two,
 * and a new realm is added in the adapter rather than in every handler.
 */
export interface IIdentityReaderPort {
    /**
     * Looks up an identity in the given realm strictly by its email address.
     *
     * @param realm The bounded context that owns the identity
     * @param email The email address to search for
     * @returns The associated identity
     * @throws {ResourceNotFoundException} If no identity is found
     */
    getCredentialsByEmail(realm: IdentityRealm, email: string): Promise<AuthIdentity>;

    /**
     * Retrieves an identity's ban status and current session version by its unique identifier.
     *
     * @param realm The bounded context that owns the identity
     * @param id The unique identifier of the target identity
     * @returns The ban status and current session version
     * @throws {ResourceNotFoundException} If no identity is found
     */
    getAuthState(realm: IdentityRealm, id: string): Promise<{ isBanned: boolean; version: number }>;
}
